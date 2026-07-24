from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from models.models import LabResult, Patient
from models.org import Tenant, ReferralDoctor, Franchise
from models.billing import BillItem
from models.clinical import SampleEvent, EventType
from models.commission import DoctorCommission
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
                                 HRFlowable, Image, PageBreak, KeepTogether)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.barcode import createBarcodeDrawing
from reportlab.graphics.shapes import Drawing, Rect
from services.report_link import report_view_url
from services.report_settings import get_report_settings
import io
import os
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

router = APIRouter()


def _render_chromatogram(values, color):
    """Render the GH-900 absorbance curve to an in-memory PNG for the PDF.

    Plots the FULL curve on a 0–TIME_MAX time axis (calibrated to the
    analyser's display window) with ticks every 20, so the peak lands at the
    same position as on the machine screen. No baseline trimming — the
    leading/trailing baseline is part of the run, exactly as the machine shows.
    """
    from matplotlib.ticker import MultipleLocator

    TIME_MAX = 130   # GH-900 display window; matches the machine's x-axis
    n = len(values)
    xs = [i * TIME_MAX / (n - 1) for i in range(n)] if n > 1 else [0]

    fig, ax = plt.subplots(figsize=(6, 2.2), dpi=120)
    ax.plot(xs, values, color='#dc2626', linewidth=1)
    ax.set_xlim(0, TIME_MAX)
    ax.set_ylim(0, max(values) * 1.1 if values and max(values) > 0 else 1)
    ax.xaxis.set_major_locator(MultipleLocator(20))   # ticks every 20
    ax.set_xlabel('Time', fontsize=7, color=color)
    ax.set_ylabel('10mOD', fontsize=7, color=color)
    ax.tick_params(axis='both', labelsize=6, colors=color)
    for spine in ax.spines.values():
        spine.set_color('#bdeae2')
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format='png', transparent=True)
    plt.close(fig)
    buf.seek(0)
    return buf

def _qr_drawing(data: str, size_cm: float = 2.0) -> Drawing:
    """Build a square QR Drawing scaled to size_cm."""
    size = size_cm * cm
    qr = QrCodeWidget(data)
    b = qr.getBounds()
    w, h = (b[2] - b[0]) or 1, (b[3] - b[1]) or 1
    d = Drawing(size, size, transform=[size / w, 0, 0, size / h, 0, 0])
    d.add(qr)
    return d


_LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'healthycian_logo.jpg')
_LOGO_ASPECT = 320 / 994   # source image is 994x320 (icon + wordmark + tagline lockup)


def _logo_image(width_cm: float = 4.6):
    """The real Healthycian logo (icon+wordmark+tagline), sized to width_cm with height from its own aspect ratio."""
    w = width_cm * cm
    h = w * _LOGO_ASPECT
    return Image(_LOGO_PATH, width=w, height=h)


def _barcode_drawing(value: str, width_cm: float = 4.2, height_cm: float = 1.1):
    """Code128 barcode for the Sample ID (accession number), matching the
    printed-label barcode used on the physical letterhead report."""
    if not value:
        return None
    try:
        d = createBarcodeDrawing('Code128', value=value, barHeight=height_cm * cm,
                                  humanReadable=True, fontSize=7)
        # scale to the requested width
        scale = (width_cm * cm) / d.width if d.width else 1
        d.width *= scale
        d.height *= scale
        d.scale(scale, 1)
        return d
    except Exception:
        return None


def _fmt_dt(dt) -> str:
    return dt.strftime('%d %b %Y, %I:%M %p') if dt else '—'


# ── Dynamic report-context helpers ─────────────────────────────────────────
# These pull together data that lives across several tables (patient
# registration, sample_events, bill_items, doctor_commissions) so the
# letterhead report can show the same fields a real accession-based lab
# report shows, without duplicating any of that data onto LabResult itself.

def _collection_time(patient) -> str:
    """Collection Time = when the patient was registered."""
    return _fmt_dt(patient.created_at) if patient else '—'


def _receiving_time(db: Session, barcode: str):
    """Receiving Time = the sample_events row for this barcode where
    event_type == 'received' (there's one receiving event per physical
    sample tube, shared by every test on that barcode)."""
    if not barcode:
        return None
    ev = (db.query(SampleEvent)
            .filter(SampleEvent.barcode == barcode, SampleEvent.event_type == EventType.RECEIVED)
            .order_by(SampleEvent.event_at.desc())
            .first())
    return ev.event_at if ev else None


def _reporting_time(db: Session, accession_number: str):
    """Reporting Time for one specific test = when that bill_item (matched
    by accession_number) was validated. Falls back to the doctor_commissions
    validated_at for the same accession when the bill_item itself has none
    (e.g. legacy rows) — the two are frozen from the same event so either
    is correct when present."""
    if not accession_number:
        return None
    item = (db.query(BillItem)
              .filter(BillItem.accession_number == accession_number)
              .order_by(BillItem.id.desc()).first())
    if item and item.validated_at:
        return item.validated_at
    comm = (db.query(DoctorCommission)
              .filter(DoctorCommission.accession_number == accession_number)
              .order_by(DoctorCommission.id.desc()).first())
    return comm.validated_at if comm else None


def _source_label(db: Session, patient) -> str:
    """DIRECT for a walk-in patient, otherwise the organization/franchise name."""
    if not patient or not patient.organization_id:
        return 'DIRECT'
    org_ = db.query(Franchise).filter(Franchise.id == patient.organization_id).first()
    return org_.name if org_ else 'DIRECT'


def _referral_label(db: Session, patient) -> str:
    """SELF when no referral doctor was recorded, otherwise their name."""
    if not patient or not patient.referral_doctor_id:
        return 'SELF'
    doc = db.query(ReferralDoctor).filter(ReferralDoctor.id == patient.referral_doctor_id).first()
    return doc.name if doc else 'SELF'


def generate_pdf(result: LabResult) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm,   bottomMargin=1.5*cm,
        title=f"Healthycian Lab Report #{result.id}"
    )

    styles = getSampleStyleSheet()
    GREEN      = colors.HexColor('#0e7d6b')
    GREEN_LIGHT= colors.HexColor('#e3f7f3')
    GREEN_ACC  = colors.HexColor('#17b9a1')
    CREAM      = colors.HexColor('#f2fbfa')
    MUTED      = colors.HexColor('#5c7370')
    RED        = colors.HexColor('#dc2626')
    BLUE       = colors.HexColor('#2563eb')
    AMBER      = colors.HexColor('#d97706')

    title_style = ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=22, textColor=GREEN, spaceAfter=2, leading=26)
    sub_style   = ParagraphStyle('sub',   fontName='Helvetica',      fontSize=9,  textColor=MUTED, spaceAfter=4)
    label_style = ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=7,  textColor=MUTED, spaceAfter=1, leading=10)
    value_style = ParagraphStyle('value', fontName='Helvetica-Bold', fontSize=10, textColor=GREEN, spaceAfter=2)
    section_style=ParagraphStyle('section',fontName='Helvetica-Bold',fontSize=8,  textColor=MUTED, spaceAfter=4, leading=12)
    normal_style= ParagraphStyle('norm',  fontName='Helvetica',      fontSize=9,  textColor=GREEN, leading=13)
    footer_style= ParagraphStyle('footer',fontName='Helvetica',      fontSize=7,  textColor=MUTED, alignment=TA_CENTER)

    story = []

    # ── HEADER ──────────────────────────────────────────────
    qr_caption = ParagraphStyle('qrcap', fontName='Helvetica', fontSize=6, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2, leading=7)
    brand_style = ParagraphStyle('brand', fontName='Helvetica-Bold', fontSize=17, textColor=GREEN, leading=18)
    brand_sub   = ParagraphStyle('brandsub', fontName='Helvetica-Bold', fontSize=8, textColor=MUTED, leading=11, spaceBefore=1)

    # left cell: real Healthycian logo (icon+wordmark+tagline already baked into the image) + "LAB REPORT · Report #N"
    left_block = Table([
        [_logo_image(4.6)],
        [Paragraph(f'LAB REPORT&nbsp;·&nbsp;Report #{result.id}', brand_sub)],
    ])
    left_block.setStyle(TableStyle([
        ('ALIGN', (0,0),(-1,-1), 'LEFT'),
        ('LEFTPADDING', (0,0),(-1,-1), 0), ('RIGHTPADDING', (0,0),(-1,-1), 0),
        ('TOPPADDING', (0,0),(-1,-1), 0), ('BOTTOMPADDING', (0,0),(0,0), 2),
    ]))

    header_data = [[
        left_block,
        [_qr_drawing(report_view_url(result.id), 2.0), Paragraph('Scan to verify', qr_caption)],
    ]]
    header_table = Table(header_data, colWidths=['74%','26%'])
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), GREEN_LIGHT),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING',    (0,0),(-1,-1), 12),
        ('BOTTOMPADDING', (0,0),(-1,-1), 12),
        ('LEFTPADDING',   (0,0),(-1,-1), 16),
        ('RIGHTPADDING',  (0,0),(-1,-1), 16),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('ALIGN',         (1,0),(1,0), 'RIGHT'),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#9fe0d3')),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.4*cm))

    # ── PATIENT INFO ─────────────────────────────────────────
    patient     = result.patient
    parsed      = result.parsed_data or {}
    device      = result.device
    report_date = result.created_at.strftime('%d %b %Y, %I:%M %p') if result.created_at else datetime.now().strftime('%d %b %Y, %I:%M %p')

    info_data = [
        [
            Paragraph('PATIENT NAME', label_style),
            Paragraph('BARCODE',      label_style),
            Paragraph('ACCESSION NO.', label_style),
            Paragraph('AGE / GENDER', label_style),
            Paragraph('DOCTOR',       label_style),
        ],
        [
            Paragraph(patient.patient_name if patient else 'Unknown', value_style),
            Paragraph(result.barcode or '—',                          value_style),
            Paragraph(result.accession_number or '—',                 value_style),
            Paragraph(f"{patient.age or '—'} / {patient.gender or '—'}" if patient else '—', value_style),
            Paragraph(patient.doctor_name or '—' if patient else '—', value_style),
        ],
        [
            Paragraph('SAMPLE TYPE', label_style),
            Paragraph('DEVICE',      label_style),
            Paragraph('PROTOCOL',    label_style),
            Paragraph('REPORT DATE', label_style),
            Paragraph('', label_style),
        ],
        [
            Paragraph(patient.sample_type if patient else '—', value_style),
            Paragraph(device.name if device else 'Manual',     value_style),
            Paragraph(parsed.get('protocol','ASTM'),           value_style),
            Paragraph(report_date,                             value_style),
            Paragraph('',                                      value_style),
        ],
    ]
    info_table = Table(info_data, colWidths=['20%','20%','20%','20%','20%'])
    info_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.white),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#bdeae2')),
        ('GRID',          (0,0),(-1,-1), 0.5, colors.HexColor('#f0f4f0')),
        ('TOPPADDING',    (0,0),(-1,-1), 7),
        ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('ROWBACKGROUND', (0,0),(-1,0),  CREAM),
        ('ROWBACKGROUND', (0,2),(-1,2),  CREAM),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.4*cm))

    # ── TEST RESULTS ─────────────────────────────────────────
    story.append(Paragraph('TEST RESULTS', section_style))

    parameters = parsed.get('parameters', [])
    if parameters:
        col_headers = [
            Paragraph('<b>TEST PARAMETER</b>', ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_LEFT)),
            Paragraph('<b>RESULT</b>',          ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph('<b>UNIT</b>',             ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph('<b>REFERENCE RANGE</b>', ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph('<b>STATUS</b>',           ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
        ]
        table_data = [col_headers]

        row_styles = []
        for idx, p in enumerate(parameters):
            flag  = p.get('flag','N')
            value = p.get('value', '')
            row   = idx + 1

            if flag == 'H':
                val_color = RED;  status_txt = 'HIGH ↑'; bg = colors.HexColor('#fef2f2')
            elif flag == 'L':
                val_color = BLUE; status_txt = 'LOW ↓';  bg = colors.HexColor('#eff6ff')
            else:
                val_color = colors.HexColor('#16a34a'); status_txt = 'Normal'; bg = colors.white

            ref_range = f"{p.get('ref_min','')} – {p.get('ref_max','')}"
            table_data.append([
                Paragraph(p.get('name', p.get('param','')),
                          ParagraphStyle('td', fontName='Helvetica', fontSize=9, textColor=GREEN)),
                Paragraph(f'<b>{value}</b>',
                          ParagraphStyle('tv', fontName='Helvetica-Bold', fontSize=10, textColor=val_color, alignment=TA_CENTER)),
                Paragraph(str(p.get('unit','')),
                          ParagraphStyle('tu', fontName='Helvetica', fontSize=9, textColor=MUTED, alignment=TA_CENTER)),
                Paragraph(ref_range,
                          ParagraphStyle('tr', fontName='Helvetica', fontSize=9, textColor=MUTED, alignment=TA_CENTER)),
                Paragraph(f'<b>{status_txt}</b>',
                          ParagraphStyle('ts', fontName='Helvetica-Bold', fontSize=8, textColor=val_color, alignment=TA_CENTER)),
            ])
            row_styles.append(('BACKGROUND', (0,row),(-1,row), bg))

        result_table = Table(table_data, colWidths=['35%','15%','15%','20%','15%'])
        result_table.setStyle(TableStyle([
            ('BACKGROUND',    (0,0),(-1,0),  GREEN),
            ('TOPPADDING',    (0,0),(-1,-1), 8),
            ('BOTTOMPADDING', (0,0),(-1,-1), 8),
            ('LEFTPADDING',   (0,0),(-1,-1), 10),
            ('RIGHTPADDING',  (0,0),(-1,-1), 10),
            ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#bdeae2')),
            ('LINEBELOW',     (0,0),(-1,-2), 0.5, colors.HexColor('#e3f7f3')),
            ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
            *row_styles,
        ]))
        story.append(result_table)
    else:
        story.append(Paragraph('No parameters found in this result.', normal_style))

    story.append(Spacer(1, 0.5*cm))

    # ── GH-900 RESULT DETAILS (NGSP/IFCC/Area) ───────────────
    gh900_info = parsed.get('gh900_info')
    if gh900_info:
        story.append(Paragraph('RESULT DETAILS', section_style))
        gh_data = [
            [
                Paragraph('NGSP',   label_style),
                Paragraph('IFCC',   label_style),
                Paragraph('AREA (TOTAL)', label_style),
            ],
            [
                Paragraph(f"{gh900_info.get('ngsp','—')} %", value_style),
                Paragraph(f"{gh900_info.get('ifcc','—')} mmol/mol", value_style),
                Paragraph(f"{gh900_info.get('area_total','—')}", value_style),
            ],
        ]
        gh_table = Table(gh_data, colWidths=['33.33%','33.33%','33.34%'])
        gh_table.setStyle(TableStyle([
            ('BACKGROUND',    (0,0),(-1,-1), colors.white),
            ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#bdeae2')),
            ('GRID',          (0,0),(-1,-1), 0.5, colors.HexColor('#f0f4f0')),
            ('TOPPADDING',    (0,0),(-1,-1), 7),
            ('BOTTOMPADDING', (0,0),(-1,-1), 7),
            ('LEFTPADDING',   (0,0),(-1,-1), 10),
            ('RIGHTPADDING',  (0,0),(-1,-1), 10),
            ('ROWBACKGROUND', (0,0),(-1,0),  CREAM),
        ]))
        story.append(gh_table)
        story.append(Spacer(1, 0.4*cm))

    # ── CHROMATOGRAM ───────────────────────────────────────
    chromatogram = parsed.get('chromatogram')
    if chromatogram:
        story.append(Paragraph('CHROMATOGRAM', section_style))
        chart_buf = _render_chromatogram(chromatogram, '#5c7370')
        story.append(Image(chart_buf, width=16*cm, height=5.5*cm))
        story.append(Spacer(1, 0.4*cm))

    # ── NOTES (only if present) ────────────────────────────────
    if result.note:
        story.append(Paragraph('NOTES', section_style))
        note_table = Table([[Paragraph(result.note.replace('\n', '<br/>'), normal_style)]], colWidths=['100%'])
        note_table.setStyle(TableStyle([
            ('BACKGROUND',    (0,0),(-1,-1), CREAM),
            ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#bdeae2')),
            ('TOPPADDING',    (0,0),(-1,-1), 10), ('BOTTOMPADDING', (0,0),(-1,-1), 10),
            ('LEFTPADDING',   (0,0),(-1,-1), 12), ('RIGHTPADDING',  (0,0),(-1,-1), 12),
        ]))
        story.append(note_table)
        story.append(Spacer(1, 0.4*cm))

    # ── LEGEND ───────────────────────────────────────────────
    legend_data = [[
        Paragraph('<b>Legend:</b>',        ParagraphStyle('leg', fontName='Helvetica-Bold', fontSize=8, textColor=GREEN)),
        Paragraph('↑ HIGH — Above reference range', ParagraphStyle('lh', fontName='Helvetica', fontSize=8, textColor=RED)),
        Paragraph('↓ LOW — Below reference range',  ParagraphStyle('ll', fontName='Helvetica', fontSize=8, textColor=BLUE)),
        Paragraph('Normal — Within reference range', ParagraphStyle('ln', fontName='Helvetica', fontSize=8, textColor=colors.HexColor('#16a34a'))),
    ]]
    legend_table = Table(legend_data, colWidths=['15%','30%','27%','28%'])
    legend_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CREAM),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#bdeae2')),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    story.append(legend_table)
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#bdeae2')))
    story.append(Spacer(1, 0.2*cm))

    # ── FOOTER ───────────────────────────────────────────────
    story.append(Paragraph(
        f'Generated by Healthycian Lab Middleware · {datetime.now().strftime("%d %b %Y %I:%M %p")} · This report is computer-generated and valid without signature.',
        footer_style
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


def generate_combined_pdf(results: list, db: Session) -> bytes:
    """The official letterhead-style sample report: one shared header +
    patient-info block, then one dynamic section per test/panel (any number
    of panels, any set of parameters — nothing hardcoded), a configurable
    pathologist signature block, and a repeating letterhead footer.

    Layout ("continuous" vs. "page_break" — one panel per page) and every
    letterhead / signature detail come from Tenant.report_settings via
    services.report_settings.get_report_settings(), so a lab can reconfigure
    its own report without a code change.
    """
    buffer = io.BytesIO()
    first = results[0]
    patient = first.patient
    tenant = (db.query(Tenant).filter(Tenant.id == patient.tenant_id).first()
              if patient and patient.tenant_id else None)
    cfg = get_report_settings(tenant)
    page_break_layout = cfg.get('layout') == 'page_break'

    GREEN      = colors.HexColor('#0e7d6b')
    GREEN_LIGHT= colors.HexColor('#e3f7f3')
    CREAM      = colors.HexColor('#f2fbfa')
    MUTED      = colors.HexColor('#5c7370')
    RED        = colors.HexColor('#dc2626')
    BLUE       = colors.HexColor('#2563eb')
    NORMAL_C   = colors.HexColor('#16a34a')
    TEAL_FOOT  = colors.HexColor('#0b4d3e')
    BORDER     = colors.HexColor('#bdeae2')

    label_style   = ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=7,   textColor=MUTED, spaceAfter=1, leading=9)
    value_style   = ParagraphStyle('value', fontName='Helvetica-Bold', fontSize=9.5, textColor=GREEN, spaceAfter=5, leading=12)
    section_style = ParagraphStyle('section', fontName='Helvetica-Bold', fontSize=10.5, textColor=GREEN, spaceAfter=2, leading=13)
    meta_style    = ParagraphStyle('meta', fontName='Helvetica', fontSize=7.5, textColor=MUTED, spaceAfter=6, leading=10)
    normal_style  = ParagraphStyle('norm', fontName='Helvetica', fontSize=9, textColor=GREEN, leading=13)
    qr_caption    = ParagraphStyle('qrcap', fontName='Helvetica', fontSize=6, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2, leading=7)
    addr_style    = ParagraphStyle('addr', fontName='Helvetica', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10)
    addr_bold     = ParagraphStyle('addrb', fontName='Helvetica-Bold', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10)
    sig_name      = ParagraphStyle('signame', fontName='Helvetica-Bold', fontSize=10, textColor=GREEN, leading=13)
    sig_sub       = ParagraphStyle('sigsub', fontName='Helvetica', fontSize=8, textColor=MUTED, leading=11)
    end_style     = ParagraphStyle('end', fontName='Helvetica-Bold', fontSize=8, textColor=MUTED, alignment=TA_CENTER, spaceBefore=6, spaceAfter=4)
    disclaim_style= ParagraphStyle('disc', fontName='Helvetica', fontSize=7.5, textColor=MUTED, alignment=TA_CENTER)

    BOTTOM_MARGIN = 2.7 * cm   # reserved for the repeating letterhead footer band
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=BOTTOM_MARGIN,
        title=f"{cfg['lab_name']} Lab Report — {first.barcode}"
    )

    story = []

    # ── LETTERHEAD HEADER (once) ────────────────────────────────
    addr_block = [Paragraph('<b>Reg. Office &amp; Centralised Lab:</b>', addr_bold)]
    addr_block += [Paragraph(l, addr_style) for l in cfg['address_lines']]
    addr_block.append(Paragraph(' / '.join(cfg['phones']), addr_style))
    addr_block.append(Paragraph(cfg['email'], addr_style))

    header_table = Table([[_logo_image(5.2), addr_block]], colWidths=['52%', '48%'])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0),(-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0),(-1,-1), 0), ('RIGHTPADDING', (0,0),(-1,-1), 0),
        ('TOPPADDING', (0,0),(-1,-1), 0), ('BOTTOMPADDING', (0,0),(-1,-1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.2*cm))
    story.append(HRFlowable(width='100%', thickness=1.4, color=GREEN))
    story.append(Spacer(1, 0.45*cm))

    # ── PATIENT INFO BLOCK (once — fields that are constant for the whole
    #    sample; per-test Reporting Time / Sample ID appear with each panel
    #    below, since different tests on the same patient can validate at
    #    different times and carry different accession suffixes) ──────────
    def _kv_stack(pairs):
        rows = []
        for lbl, val in pairs:
            rows.append([Paragraph(lbl, label_style)])
            rows.append([Paragraph(str(val) if val not in (None, '') else '—', value_style)])
        t = Table(rows, colWidths=['100%'])
        t.setStyle(TableStyle([
            ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),0),
            ('TOPPADDING',(0,0),(-1,-1),0),  ('BOTTOMPADDING',(0,0),(-1,-1),0),
        ]))
        return t

    receiving_dt = _receiving_time(db, first.barcode)
    left_block = _kv_stack([
        ('PATIENT NAME', patient.patient_name if patient else 'Unknown'),
        ('AGE / GENDER', f"{patient.age or '—'} years / {patient.gender or '—'}" if patient else '—'),
        ('MOBILE NO.',   (patient.phone if patient else None) or '—'),
        ('PATIENT ID',   patient.id if patient else '—'),
        ('SOURCE',       _source_label(db, patient)),
    ])
    right_block = _kv_stack([
        ('REFERRAL',        _referral_label(db, patient)),
        ('COLLECTION TIME', _collection_time(patient)),
        ('RECEIVING TIME',  _fmt_dt(receiving_dt)),
    ])
    qr_block = [
        _qr_drawing(report_view_url(first.id), 2.1),
        Paragraph('Scan to Validate', qr_caption),
    ]
    bc = _barcode_drawing(first.barcode, 3.6, 1.0)
    sample_id_block = ([bc] if bc else []) + [Paragraph(f'Sample ID: {first.barcode or "—"}', qr_caption)]

    info_table = Table(
        [[left_block, qr_block, right_block, sample_id_block]],
        colWidths=['30%', '18%', '26%', '26%']
    )
    info_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.white),
        ('BOX',           (0,0),(-1,-1), 1, BORDER),
        ('LINEAFTER',     (0,0),(0,0), 0.5, BORDER),
        ('LINEAFTER',     (1,0),(1,0), 0.5, BORDER),
        ('LINEAFTER',     (2,0),(2,0), 0.5, BORDER),
        ('TOPPADDING',    (0,0),(-1,-1), 10), ('BOTTOMPADDING', (0,0),(-1,-1), 10),
        ('LEFTPADDING',   (0,0),(-1,-1), 12), ('RIGHTPADDING',  (0,0),(-1,-1), 12),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('ALIGN',         (1,0),(1,0), 'CENTER'),
        ('ALIGN',         (3,0),(3,0), 'CENTER'),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.5*cm))

    # ── ONE DYNAMIC SECTION PER TEST / PANEL ────────────────────
    for idx, r in enumerate(results):
        parsed = r.parsed_data or {}
        parameters = parsed.get('parameters', [])
        reporting_dt = _reporting_time(db, r.accession_number)

        section_flow = []
        section_flow.append(Paragraph((r.test_name or f'Result #{r.id}').upper(), section_style))
        section_flow.append(Paragraph(
            f'Sample ID: {r.accession_number or r.barcode or "—"} &nbsp;·&nbsp; Reported: {_fmt_dt(reporting_dt)}',
            meta_style
        ))

        if parameters:
            col_headers = [
                Paragraph('<b>TEST DESCRIPTION</b>', ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_LEFT)),
                Paragraph('<b>VALUE(S)</b>',          ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
                Paragraph('<b>UNIT(S)</b>',           ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_CENTER)),
                Paragraph('<b>REFERENCE RANGE</b>',   ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_LEFT)),
                Paragraph('<b>METHODOLOGY</b>',       ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=TA_LEFT)),
            ]
            table_data = [col_headers]
            row_styles = []
            for ridx, p in enumerate(parameters):
                flag = p.get('flag', 'N')
                value = p.get('value', '')
                row = ridx + 1
                if flag == 'H':
                    val_color = RED
                elif flag == 'L':
                    val_color = BLUE
                else:
                    val_color = NORMAL_C

                ref_min, ref_max = p.get('ref_min', ''), p.get('ref_max', '')
                has_min, has_max = ref_min not in ('', None), ref_max not in ('', None)
                ref_text = p.get('ref_text')   # free-text multi-line range, when the parser supplies one
                if ref_text:
                    ref_range = ref_text.replace('\n', '<br/>')
                elif has_min and has_max:
                    ref_range = f"{ref_min} – {ref_max}"
                elif has_max:
                    ref_range = f"&lt; {ref_max}"
                elif has_min:
                    ref_range = f"&gt; {ref_min}"
                else:
                    ref_range = '—'

                table_data.append([
                    Paragraph(p.get('name', p.get('param', '')), ParagraphStyle('td', fontName='Helvetica', fontSize=9, textColor=GREEN)),
                    Paragraph(f'<b>{value}</b>', ParagraphStyle('tv', fontName='Helvetica-Bold', fontSize=9.5, textColor=val_color, alignment=TA_CENTER)),
                    Paragraph(str(p.get('unit', '') or '—'), ParagraphStyle('tu', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_CENTER)),
                    Paragraph(ref_range, ParagraphStyle('tr', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_LEFT, leading=11)),
                    Paragraph(str(p.get('method', '') or '—'), ParagraphStyle('tm', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_LEFT, leading=11)),
                ])
                if flag in ('H', 'L'):
                    row_styles.append(('BACKGROUND', (0,row),(-1,row), colors.HexColor('#fef2f2') if flag == 'H' else colors.HexColor('#eff6ff')))

            result_table = Table(table_data, colWidths=['30%', '13%', '12%', '25%', '20%'])
            result_table.setStyle(TableStyle([
                ('BACKGROUND',    (0,0),(-1,0),  GREEN),
                ('TOPPADDING',    (0,0),(-1,-1), 7), ('BOTTOMPADDING', (0,0),(-1,-1), 7),
                ('LEFTPADDING',   (0,0),(-1,-1), 9), ('RIGHTPADDING',  (0,0),(-1,-1), 9),
                ('BOX',           (0,0),(-1,-1), 1, BORDER),
                ('LINEBELOW',     (0,0),(-1,-2), 0.5, GREEN_LIGHT),
                ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
                *row_styles,
            ]))
            section_flow.append(result_table)
        else:
            section_flow.append(Paragraph('No parameters found in this result.', normal_style))

        if r.note:
            note_table = Table([[Paragraph(f'<b>Comments:</b> {r.note}'.replace(chr(10), "<br/>"), normal_style)]], colWidths=['100%'])
            note_table.setStyle(TableStyle([
                ('BACKGROUND',    (0,0),(-1,-1), CREAM),
                ('BOX',           (0,0),(-1,-1), 1, BORDER),
                ('TOPPADDING',    (0,0),(-1,-1), 8), ('BOTTOMPADDING', (0,0),(-1,-1), 8),
                ('LEFTPADDING',   (0,0),(-1,-1), 10), ('RIGHTPADDING',  (0,0),(-1,-1), 10),
            ]))
            section_flow.append(Spacer(1, 0.15*cm))
            section_flow.append(note_table)

        # Keep each panel's title glued to its own table so a page break
        # never lands between a heading and its data.
        story.append(KeepTogether(section_flow))

        is_last = (idx == len(results) - 1)
        if not is_last:
            story.append(PageBreak() if page_break_layout else Spacer(1, 0.5*cm))

    # ── PATHOLOGIST SIGNATURE (configurable, text-only — no image) ──────
    story.append(Spacer(1, 0.9*cm))
    story.append(HRFlowable(width=4.5*cm, thickness=0.8, color=MUTED, hAlign='LEFT'))
    story.append(Paragraph(cfg['pathologist_name'], sig_name))
    story.append(Paragraph(cfg['pathologist_qualification'], sig_sub))
    story.append(Paragraph(f"Registration no {cfg['registration_no']}", sig_sub))

    # ── END OF REPORT (once, at the true end) ────────────────────
    story.append(Paragraph('**END OF REPORT**', end_style))
    story.append(Paragraph('The result is related to the sample(s) tested only.', disclaim_style))

    # ── REPEATING LETTERHEAD FOOTER (every page) ─────────────────
    def _draw_footer(canvas, doc_):
        canvas.saveState()
        band_h = 1.7 * cm
        canvas.setFillColor(TEAL_FOOT)
        canvas.rect(0, 0, A4[0], band_h, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont('Helvetica-Bold', 7.5)
        canvas.drawString(1.5*cm, band_h - 0.55*cm, f"A UNIT OF")
        canvas.setFont('Helvetica', 7.5)
        canvas.drawString(1.5*cm, band_h - 0.95*cm, cfg['unit_of'])
        canvas.setFont('Helvetica', 7)
        addr_line = 'Reg. Office & Centralised Lab: ' + ' '.join(cfg['address_lines'])
        contact_line = ' / '.join(cfg['phones']) + f"   {cfg['email']}   {cfg['website']}"
        canvas.drawCentredString(A4[0] / 2, band_h - 0.55*cm, addr_line)
        canvas.drawCentredString(A4[0] / 2, band_h - 0.95*cm, contact_line)
        canvas.setFont('Helvetica', 7)
        canvas.drawRightString(A4[0] - 1.5*cm, band_h - 0.75*cm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)
    buffer.seek(0)
    return buffer.read()




@router.get("/combined-pdf")
def download_combined_pdf(ids: str, db: Session = Depends(get_db)):
    """One PDF covering several results (e.g. all tests under one barcode),
    with a single shared header instead of one PDF per test."""
    id_list = [int(x) for x in ids.split(',') if x.strip().isdigit()]
    if not id_list:
        raise HTTPException(status_code=400, detail="no result ids given")
    results = db.query(LabResult).filter(LabResult.id.in_(id_list)).order_by(LabResult.id.asc()).all()
    if not results:
        raise HTTPException(status_code=404, detail="no matching results")
    try:
        pdf_bytes = generate_combined_pdf(results, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Healthycian_Combined_{results[0].barcode}.pdf"}
    )


@router.get("/{result_id}/pdf")
def download_pdf(result_id: int, db: Session = Depends(get_db)):
    result = db.query(LabResult).filter(LabResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    try:
        pdf_bytes = generate_pdf(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Healthycian_Report_{result_id}.pdf"}
    )
