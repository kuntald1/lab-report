from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from database import get_db
from models.models import LabResult, Patient
from models.org import Tenant, ReferralDoctor, Franchise, User
from models.billing import BillItem
from models.clinical import SampleEvent, EventType
from models.commission import DoctorCommission
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
                                 HRFlowable, Image, PageBreak, KeepTogether, Flowable)
from reportlab.platypus.doctemplate import FrameBreak
from reportlab.platypus.flowables import _listWrapOn, _flowableSublist
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.barcode import createBarcodeDrawing
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.lib.utils import ImageReader
from services.report_link import report_view_url
from services.report_settings import get_report_settings, asset_path, asset_url
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
_ICON_PATH  = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'healthycian_icon.png')


class _BottomPinnedBlock(Flowable):
    """A block of flowables that behaves like KeepTogether (never splits
    internally — moves to the next page as one atomic unit if it doesn't fit
    on the current one) but ALSO renders flush against the bottom of
    whichever frame it ends up fitting on, instead of wherever it happens to
    land in the normal top-down flow.

    This exists because a simple "spacer sized to (remaining space - content
    height)" approach breaks the moment the content doesn't fit on the
    current page: the spacer gets consumed on the page where there wasn't
    enough room, the content then spills to the next page anyway (since
    Platypus won't split a KeepTogether), and it lands stranded at the TOP
    of that next page with no spacer to push it back down. Mirrors
    KeepTogether's own wrap()/split() trick (return a huge sentinel height
    to force split() to run, decide there vs. here) — see
    reportlab.platypus.flowables.KeepTogether — except split() here
    re-inserts `self` (not the bare content) so the bottom-pin decision gets
    made fresh on whichever frame it actually lands on."""
    def __init__(self, flowables):
        Flowable.__init__(self)
        self._content = _flowableSublist(flowables)

    def wrap(self, aW, aH):
        W, H = _listWrapOn(self._content, aW, self.canv)
        self._H = H
        self._wrapInfo = (aW, aH)
        return aW, 0xFFFFFF   # force split() to be called, same trick KeepTogether uses

    def split(self, aW, aH):
        if getattr(self, '_wrapInfo', None) != (aW, aH):
            self.wrap(aW, aH)
        if self._H > aH:
            # Doesn't fit here at all — defer the WHOLE block to the next
            # frame and retry there. Re-inserting `self` (not just the raw
            # content) means wrap()/split() run again on the new frame, so
            # the bottom-pin padding gets recalculated for wherever it
            # actually lands rather than being baked in for this page.
            return [FrameBreak(), self]
        pad = max(aH - self._H, 0)
        return [Spacer(1, pad)] + list(self._content)


def _sized_image(path, width_cm: float):
    """An Image flowable at width_cm wide, height computed from the file's
    own aspect ratio — works for any uploaded logo/signature regardless of
    its native dimensions. Returns None if the file can't be read."""
    try:
        iw, ih = ImageReader(path).getSize()
        w = width_cm * cm
        h = w * (ih / iw)
        return Image(path, width=w, height=h)
    except Exception:
        return None


def _logo_image(cfg: dict, width_cm: float = 4.6):
    """The lab's logo — an uploaded one if the tenant has configured it,
    otherwise the built-in Healthycian logo (fixed aspect, baked asset)."""
    custom = cfg.get('logo_filename') if cfg else None
    if custom:
        img = _sized_image(asset_path(custom), width_cm)
        if img:
            return img
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


def _wrap_text(text: str, font: str, size: float, max_w: float, max_lines: int = 99):
    """Greedy word-wrap using the real font metrics (no canvas needed — this
    can run before the page/canvas exists, e.g. to size the footer band).
    Never silently drops words: if max_lines is reached, whatever's left is
    appended to the last line rather than discarded."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    words = text.split(' ')
    lines, cur = [], ''
    for i, w in enumerate(words):
        trial = (cur + ' ' + w).strip()
        if stringWidth(trial, font, size) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
        if len(lines) == max_lines - 1:
            # Everything remaining collapses onto the final allowed line
            # rather than being dropped, even if it overflows visually.
            rest = words[i + 1:]
            cur = ' '.join([cur] + rest) if rest else cur
            break
    if cur:
        lines.append(cur)
    return lines


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


def _validating_doctor(db: Session, results: list, tenant_id, cfg: dict) -> dict:
    """Who actually signs this report: the pathologist who validated the
    most recently reported test in this combined report (BillItem.validated_by),
    resolved to their referral_doctors row via User.referral_doctor_id — a
    real FK (services/doctor_sync.py) — so THEIR own uploaded signature,
    qualification, and registration number print, not one tenant-wide
    default, and renaming the doctor later never loses the link.

    Once a real validator is identified, their name is ALWAYS what prints —
    qualification/registration/signature come only from their own
    referral_doctors row, and any of those left blank just don't print
    (no borrowing the tenant's generic defaults for a named, specific
    doctor — that produced misleading output like "manna, MD (Pathology),
    Registration no 63582" when manna had set none of that).

    The tenant's default pathologist_name/qualification/registration_no
    (services/report_settings.py) is used ONLY as a last resort when no
    validator can be identified at all — no BillItem, no validated_by, or
    no resolvable user name."""
    fallback = {
        'name': cfg['pathologist_name'],
        'qualification': cfg['pathologist_qualification'],
        'registration_no': cfg['registration_no'],
        'signature_filename': None,
    }
    accession_numbers = [r.accession_number for r in results if r.accession_number]
    if not accession_numbers:
        return fallback

    item = (db.query(BillItem)
              .filter(BillItem.accession_number.in_(accession_numbers), BillItem.validated_by.isnot(None))
              .order_by(BillItem.validated_at.desc().nullslast(), BillItem.id.desc())
              .first())
    if not item or not item.validated_by:
        return fallback

    validator = db.query(User).filter(User.id == item.validated_by).first()
    name = (validator.full_name or validator.email or '').strip() if validator else ''
    if not name:
        return fallback

    doctor = None
    if validator and validator.referral_doctor_id:
        # The real link — unambiguous, and immune to either side being renamed.
        doctor = db.query(ReferralDoctor).filter(ReferralDoctor.id == validator.referral_doctor_id).first()

    if not doctor:
        # Fallback for a login that hasn't been linked yet (e.g. created
        # right before this exact request, before any doctor-list page
        # triggered services/doctor_sync.py). Same-name referral_doctors
        # rows can genuinely be duplicates in practice, so score every
        # same-named candidate and prefer whichever one actually HAS data,
        # tenant match second, oldest last as a final tiebreak — a stray
        # blank duplicate can never win over a record that's filled in.
        candidates = (db.query(ReferralDoctor)
                        .filter(sqlfunc.lower(ReferralDoctor.name) == name.lower())
                        .all())
        if candidates:
            def _score(d):
                has_data = bool(d.qualification or d.registration_no or d.signature_filename)
                same_tenant = tenant_id is not None and d.tenant_id == tenant_id
                return (not has_data, not same_tenant, d.id)   # False sorts before True, so "has data" wins
            doctor = sorted(candidates, key=_score)[0]

    # From here on the validator is a known, named person — never fall back
    # to the tenant's generic identity for their missing fields, just omit them.
    return {
        'name': (doctor.name if doctor and doctor.name else name),
        'qualification': (doctor.qualification or '') if doctor else '',
        'registration_no': (doctor.registration_no or '') if doctor else '',
        'signature_filename': doctor.signature_filename if doctor else None,
    }


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
        [_logo_image({}, 4.6)],
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
    pathologist signature block (typed or an uploaded image), and a
    repeating letterhead footer with a faint logo watermark behind the body.

    Layout ("continuous" vs. "page_break" — one panel per page), the lab's
    logo/letterhead details, and the pathologist signature all come from
    Tenant.report_settings via services.report_settings.get_report_settings(),
    so a lab can reconfigure its own report (including uploading its own
    logo/signature images) without a code change.
    """
    buffer = io.BytesIO()
    first = results[0]
    patient = first.patient
    tenant = (db.query(Tenant).filter(Tenant.id == patient.tenant_id).first()
              if patient and patient.tenant_id else None)
    cfg = get_report_settings(tenant)
    page_break_layout = cfg.get('layout') == 'page_break'

    BLACK      = colors.HexColor('#1a1a1a')
    GREEN      = colors.HexColor('#0e7d6b')
    MUTED      = colors.HexColor('#5c7370')
    BORDER     = colors.HexColor('#d8d8d8')
    TEAL_FOOT  = colors.HexColor('#0b4d3e')

    label_style   = ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=7,   textColor=MUTED, spaceAfter=1, leading=9)
    value_style   = ParagraphStyle('value', fontName='Helvetica-Bold', fontSize=9.5, textColor=BLACK, spaceAfter=5, leading=12)
    section_style = ParagraphStyle('section', fontName='Helvetica-Bold', fontSize=10.5, textColor=BLACK, spaceAfter=6, leading=13)
    normal_style  = ParagraphStyle('norm', fontName='Helvetica', fontSize=9, textColor=BLACK, leading=13)
    qr_caption    = ParagraphStyle('qrcap', fontName='Helvetica', fontSize=6, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2, leading=7)
    addr_style    = ParagraphStyle('addr', fontName='Helvetica', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10)
    addr_bold     = ParagraphStyle('addrb', fontName='Helvetica-Bold', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10)
    sig_name      = ParagraphStyle('signame', fontName='Helvetica-Bold', fontSize=10, textColor=BLACK, leading=13)
    sig_sub       = ParagraphStyle('sigsub', fontName='Helvetica', fontSize=8, textColor=MUTED, leading=11)
    end_style     = ParagraphStyle('end', fontName='Helvetica-Bold', fontSize=8, textColor=MUTED, alignment=TA_CENTER, spaceBefore=6, spaceAfter=4)
    disclaim_style= ParagraphStyle('disc', fontName='Helvetica', fontSize=7.5, textColor=MUTED, alignment=TA_CENTER)
    comments_style= ParagraphStyle('comm', fontName='Helvetica', fontSize=8.5, textColor=BLACK, leading=12)

    # ── Footer geometry, computed BEFORE the doc is built so the band is
    #    always tall enough for whatever this tenant configured — a long
    #    address or business name wraps to more lines instead of being cut
    #    off or overlapping the next column. ─────────────────────────────
    PAGE_W = A4[0]
    FOOT_LEFT_X, FOOT_LEFT_W = 1.5*cm, 4.6*cm
    FOOT_RIGHT_W = 2.4*cm
    FOOT_CENTER_X0 = FOOT_LEFT_X + FOOT_LEFT_W + 0.4*cm
    FOOT_CENTER_W  = PAGE_W - 1.5*cm - FOOT_RIGHT_W - FOOT_CENTER_X0

    _foot_left_lines = ['A UNIT OF'] + _wrap_text(cfg['unit_of'], 'Helvetica', 6.5, FOOT_LEFT_W, max_lines=2)
    _foot_addr_line    = 'Reg. Office & Centralised Lab: ' + ' '.join(cfg['address_lines'])
    _foot_contact_line = ' / '.join(cfg['phones'])
    _foot_web_line     = f"{cfg['email']}   {cfg['website']}"
    _foot_center_lines = (
        _wrap_text(_foot_addr_line, 'Helvetica-Bold', 6.5, FOOT_CENTER_W, max_lines=2)
        + _wrap_text(_foot_contact_line, 'Helvetica', 6.5, FOOT_CENTER_W, max_lines=1)
        + _wrap_text(_foot_web_line, 'Helvetica', 6.5, FOOT_CENTER_W, max_lines=1)
    )
    _foot_line_count = max(len(_foot_left_lines), len(_foot_center_lines))
    LINE_H = 0.38 * cm
    FOOTER_BAND_H = _foot_line_count * LINE_H + 0.55*cm   # padding top+bottom
    BOTTOM_MARGIN = FOOTER_BAND_H + 0.6 * cm
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

    header_table = Table([[_logo_image(cfg, 5.2), addr_block]], colWidths=['52%', '48%'])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0),(-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0),(-1,-1), 0), ('RIGHTPADDING', (0,0),(-1,-1), 0),
        ('TOPPADDING', (0,0),(-1,-1), 0), ('BOTTOMPADDING', (0,0),(-1,-1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.2*cm))
    story.append(HRFlowable(width='100%', thickness=1.4, color=GREEN))
    story.append(Spacer(1, 0.45*cm))

    # ── PATIENT INFO BLOCK (once) — Reporting Time here is the most recent
    #    validation across every panel in this report, so the header always
    #    reflects "when the whole thing was actually ready" ─────────────
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
    reporting_times = [t for t in (_reporting_time(db, r.accession_number) for r in results) if t]
    reporting_dt = max(reporting_times) if reporting_times else None

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
        ('REPORTING TIME',  _fmt_dt(reporting_dt)),
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
    story.append(Spacer(1, 0.55*cm))

    # ── ONE DYNAMIC SECTION PER TEST / PANEL ─────────────────────
    # Clean, black-on-white, professional layout: an underlined panel title,
    # then a plain-ruled table (no colour fills) — abnormal values are bold,
    # everything else is regular weight, exactly like a printed lab report.
    signers, seen_signers = [], set()   # distinct validating doctors, collected while looping, rendered together at the end
    for idx, r in enumerate(results):
        parsed = r.parsed_data or {}
        parameters = parsed.get('parameters', [])

        section_flow = [Paragraph(f'<u>{(r.test_name or f"Result #{r.id}").upper()}</u>', section_style)]

        if parameters:
            th_style = ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8, textColor=BLACK)
            col_headers = [
                Paragraph('TEST DESCRIPTION', th_style),
                Paragraph('VALUE(S)', ParagraphStyle('th2', parent=th_style, alignment=TA_CENTER)),
                Paragraph('UNIT(S)', ParagraphStyle('th3', parent=th_style, alignment=TA_CENTER)),
                Paragraph('REFERENCE RANGE', th_style),
                Paragraph('METHODOLOGY', th_style),
            ]
            table_data = [col_headers]
            for p in parameters:
                flag = p.get('flag', 'N')
                value = p.get('value', '')
                bold = flag in ('H', 'L')

                ref_min, ref_max = p.get('ref_min', ''), p.get('ref_max', '')
                has_min, has_max = ref_min not in ('', None), ref_max not in ('', None)
                ref_text = p.get('ref_text')
                if ref_text:
                    ref_range = ref_text.replace('\n', '<br/>')
                elif has_min and has_max:
                    ref_range = f"{ref_min} \u2013 {ref_max}"
                elif has_max:
                    ref_range = f"&lt; {ref_max}"
                elif has_min:
                    ref_range = f"&gt; {ref_min}"
                else:
                    ref_range = '\u2014'

                val_txt = f'<b>{value}</b>' if bold else str(value)
                name_txt = f'<b>{p.get("name", p.get("param", ""))}</b>' if bold else p.get('name', p.get('param', ''))
                table_data.append([
                    Paragraph(name_txt, ParagraphStyle('td', fontName='Helvetica', fontSize=9, textColor=BLACK)),
                    Paragraph(val_txt, ParagraphStyle('tv', fontName='Helvetica', fontSize=9.5, textColor=BLACK, alignment=TA_CENTER)),
                    Paragraph(str(p.get('unit', '') or '\u2014'), ParagraphStyle('tu', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_CENTER)),
                    Paragraph(ref_range, ParagraphStyle('tr', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_LEFT, leading=11)),
                    Paragraph(str(p.get('method', '') or '\u2014'), ParagraphStyle('tm', fontName='Helvetica', fontSize=8.5, textColor=MUTED, alignment=TA_LEFT, leading=11)),
                ])

            result_table = Table(table_data, colWidths=['30%', '13%', '12%', '25%', '20%'])
            result_table.setStyle(TableStyle([
                ('LINEBELOW',     (0,0),(-1,0),  1, BLACK),
                ('LINEBELOW',     (0,1),(-1,-1), 0.4, BORDER),
                ('TOPPADDING',    (0,0),(-1,-1), 6), ('BOTTOMPADDING', (0,0),(-1,-1), 6),
                ('LEFTPADDING',   (0,0),(-1,-1), 4), ('RIGHTPADDING',  (0,0),(-1,-1), 4),
                ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
            ]))
            section_flow.append(result_table)
        else:
            section_flow.append(Paragraph('No parameters found in this result.', normal_style))

        if r.note:
            section_flow.append(Spacer(1, 0.2*cm))
            section_flow.append(HRFlowable(width='100%', thickness=0.5, color=BORDER))
            section_flow.append(Spacer(1, 0.15*cm))
            section_flow.append(Paragraph(f'<u><b>Comments:</b></u> {r.note}'.replace(chr(10), "<br/>"), comments_style))

        # Keep each panel's title, table, and comments glued together so a
        # page break never splits them apart. Signatures are collected below
        # and shown together at the end of the report, not per panel.
        story.append(KeepTogether(section_flow))

        # Track who validated this specific panel — deduplicated afterwards
        # so each distinct doctor appears once at the end, in the order
        # their first panel appears, rather than once per doctor and once
        # per panel (a report with a doctor validating 5 tests should show
        # their signature once, not five times).
        signer = _validating_doctor(db, [r], patient.tenant_id if patient else None, cfg)
        signer_key = (signer['name'], signer['qualification'], signer['registration_no'], signer['signature_filename'])
        if signer_key not in seen_signers:
            seen_signers.add(signer_key)
            signers.append(signer)

        is_last = (idx == len(results) - 1)
        if not is_last:
            story.append(PageBreak() if page_break_layout else Spacer(1, 0.7*cm))

    # ── SIGN-OFF + END OF REPORT — pinned flush to the bottom margin of
    #    whichever page they land on (per Kuntal: always at the bottom, even
    #    when there's leftover space above), instead of floating directly
    #    under the last panel's table. Wrapped in _BottomPinnedBlock, which
    #    defers the whole block to the next page (like KeepTogether) if it
    #    doesn't fit here, and only THEN pads it flush to the bottom of
    #    whichever page it actually lands on. ─────────────────────────────
    footer_flow = []

    if signers:
        PER_ROW = 3
        COL_W = 5.7 * cm

        def _signer_cell(signer):
            cell = []
            sig_img = _sized_image(asset_path(signer['signature_filename']), 3.0) if signer['signature_filename'] else None
            if sig_img:
                cell.append(sig_img)
                cell.append(Spacer(1, 0.05*cm))
            else:
                cell.append(HRFlowable(width=3.8*cm, thickness=0.8, color=MUTED, hAlign='LEFT'))
            cell.append(Paragraph(signer['name'], sig_name))
            if signer['qualification']:
                cell.append(Paragraph(signer['qualification'], sig_sub))
            if signer['registration_no']:
                cell.append(Paragraph(f"Registration no {signer['registration_no']}", sig_sub))
            return cell

        cells = [_signer_cell(s) for s in signers]
        rows = [cells[i:i + PER_ROW] for i in range(0, len(cells), PER_ROW)]
        for row in rows:
            while len(row) < PER_ROW:
                row.append('')   # pad an incomplete last row so the table stays rectangular

        sig_table = Table(rows, colWidths=[COL_W] * PER_ROW)
        sig_table.setStyle(TableStyle([
            ('VALIGN',      (0,0),(-1,-1), 'TOP'),
            ('ALIGN',       (0,0),(-1,-1), 'LEFT'),
            ('LEFTPADDING', (0,0),(-1,-1), 0),
            ('RIGHTPADDING',(0,0),(-1,-1), 14),
            ('TOPPADDING',  (0,0),(0,-1),  0),
            ('TOPPADDING',  (0,1),(-1,-1), 16),   # gap between rows when there's more than one
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
        ]))
        footer_flow.append(Spacer(1, 1*cm))
        footer_flow.append(sig_table)

    footer_flow.append(Spacer(1, 0.3*cm))
    footer_flow.append(Paragraph('**END OF REPORT**', end_style))
    footer_flow.append(Paragraph('The result is related to the sample(s) tested only.', disclaim_style))

    story.append(_BottomPinnedBlock(footer_flow))

    # ── PAGE CHROME: faint logo watermark behind the body + repeating
    #    letterhead footer band (drawn once per page, before the page's
    #    flowables render, so both sit BEHIND the report content) ────────
    watermark_path = asset_path(cfg['logo_filename']) if cfg.get('logo_filename') else _ICON_PATH

    def _draw_page_chrome(canvas, doc_):
        canvas.saveState()
        # --- faint watermark, centred on the page, well below the text ---
        try:
            iw, ih = ImageReader(watermark_path).getSize()
            wm_w = 8.5 * cm
            wm_h = wm_w * (ih / iw)
            canvas.saveState()
            canvas.setFillAlpha(0.05)
            canvas.drawImage(watermark_path, (A4[0]-wm_w)/2, (A4[1]-wm_h)/2,
                              width=wm_w, height=wm_h, mask='auto', preserveAspectRatio=True)
            canvas.restoreState()
        except Exception:
            pass

        # --- footer band: three non-overlapping zones (brand | address | page),
        #     using the line lists computed up front so the band height and
        #     its content always agree — nothing gets cut or overlaps. ────
        canvas.setFillColor(TEAL_FOOT)
        canvas.rect(0, 0, A4[0], FOOTER_BAND_H, stroke=0, fill=1)
        canvas.setFillColor(colors.white)

        y = FOOTER_BAND_H - 0.45*cm
        canvas.setFont('Helvetica-Bold', 7)
        canvas.drawString(FOOT_LEFT_X, y, _foot_left_lines[0])
        canvas.setFont('Helvetica', 6.5)
        for line in _foot_left_lines[1:]:
            y -= LINE_H
            canvas.drawString(FOOT_LEFT_X, y, line)

        cy = FOOTER_BAND_H - 0.45*cm
        for i, line in enumerate(_foot_center_lines):
            canvas.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 6.5)
            canvas.drawCentredString(FOOT_CENTER_X0 + FOOT_CENTER_W/2, cy, line)
            cy -= LINE_H

        # right: page number
        canvas.setFont('Helvetica', 7)
        canvas.drawRightString(A4[0] - 1.5*cm, FOOTER_BAND_H - 0.6*cm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_page_chrome, onLaterPages=_draw_page_chrome)
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
        # Reuse the same letterhead renderer as the combined download, just
        # with a single result — keeps every PDF (single or combined) on
        # one consistent design instead of maintaining two report styles.
        pdf_bytes = generate_combined_pdf([result], db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Healthycian_Report_{result_id}.pdf"}
    )
