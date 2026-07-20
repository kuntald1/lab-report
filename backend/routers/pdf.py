from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from models.models import LabResult
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing, Rect
from services.report_link import report_view_url
import io
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
        spine.set_color('#d4e6d6')
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


def _logo_mark(size: float = 30):
    """A clean drawn brand mark (rounded green badge with a lab-flask glyph),
    so we never depend on an emoji font that may render as a box."""
    from reportlab.graphics.shapes import Drawing, Rect, Polygon, Circle
    g = colors.HexColor('#1a3a1c'); acc = colors.HexColor('#4caf50')
    d = Drawing(size, size)
    d.add(Rect(0, 0, size, size, rx=8, ry=8, fillColor=g, strokeColor=None))
    s = size
    # simple Erlenmeyer flask in white/green-accent
    d.add(Polygon(points=[0.42*s,0.74*s, 0.58*s,0.74*s, 0.72*s,0.30*s, 0.28*s,0.30*s],
                  fillColor=colors.white, strokeColor=None))
    d.add(Rect(0.45*s, 0.72*s, 0.10*s, 0.08*s, fillColor=colors.white, strokeColor=None))
    d.add(Circle(0.46*s, 0.40*s, 0.035*s, fillColor=acc, strokeColor=None))
    d.add(Circle(0.56*s, 0.36*s, 0.028*s, fillColor=acc, strokeColor=None))
    return d


def generate_pdf(result: LabResult) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm,   bottomMargin=1.5*cm,
        title=f"MediCloud Lab Report #{result.id}"
    )

    styles = getSampleStyleSheet()
    GREEN      = colors.HexColor('#1a3a1c')
    GREEN_LIGHT= colors.HexColor('#e8f5e0')
    GREEN_ACC  = colors.HexColor('#4caf50')
    CREAM      = colors.HexColor('#faf8f3')
    MUTED      = colors.HexColor('#5a7060')
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

    # left cell: logo mark + "MediCloud" / "LAB REPORT · Report #N"
    left_block = Table([[
        _logo_mark(30),
        Paragraph(f'MediCloud<br/><font size="8" color="#5a7060">LAB REPORT&nbsp;·&nbsp;Report #{result.id}</font>', brand_style),
    ]], colWidths=[36, None])
    left_block.setStyle(TableStyle([
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0),(-1,-1), 0), ('RIGHTPADDING', (0,0),(0,0), 8),
        ('TOPPADDING', (0,0),(-1,-1), 0), ('BOTTOMPADDING', (0,0),(-1,-1), 0),
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
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#b8ddb8')),
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
            Paragraph('AGE / GENDER', label_style),
            Paragraph('DOCTOR',       label_style),
        ],
        [
            Paragraph(patient.patient_name if patient else 'Unknown', value_style),
            Paragraph(result.barcode or '—',                          value_style),
            Paragraph(f"{patient.age or '—'} / {patient.gender or '—'}" if patient else '—', value_style),
            Paragraph(patient.doctor_name or '—' if patient else '—', value_style),
        ],
        [
            Paragraph('SAMPLE TYPE', label_style),
            Paragraph('DEVICE',      label_style),
            Paragraph('PROTOCOL',    label_style),
            Paragraph('REPORT DATE', label_style),
        ],
        [
            Paragraph(patient.sample_type if patient else '—', value_style),
            Paragraph(device.name if device else 'Manual',     value_style),
            Paragraph(parsed.get('protocol','ASTM'),           value_style),
            Paragraph(report_date,                             value_style),
        ],
    ]
    info_table = Table(info_data, colWidths=['25%','25%','25%','25%'])
    info_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.white),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
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
            ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
            ('LINEBELOW',     (0,0),(-1,-2), 0.5, colors.HexColor('#e8f5e0')),
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
            ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
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
        chart_buf = _render_chromatogram(chromatogram, '#5a7060')
        story.append(Image(chart_buf, width=16*cm, height=5.5*cm))
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
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    story.append(legend_table)
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#d4e6d6')))
    story.append(Spacer(1, 0.2*cm))

    # ── FOOTER ───────────────────────────────────────────────
    story.append(Paragraph(
        f'Generated by MediCloud Lab Middleware · {datetime.now().strftime("%d %b %Y %I:%M %p")} · This report is computer-generated and valid without signature.',
        footer_style
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


def generate_combined_pdf(results: list) -> bytes:
    """Same look as generate_pdf(), but for MULTIPLE LabResult rows that share
    one barcode: one header/patient-info block, then one TEST RESULTS section
    per result, then one legend/footer at the end."""
    buffer = io.BytesIO()
    first = results[0]
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm,   bottomMargin=1.5*cm,
        title=f"MediCloud Lab Report — {first.barcode}"
    )

    styles = getSampleStyleSheet()
    GREEN      = colors.HexColor('#1a3a1c')
    GREEN_LIGHT= colors.HexColor('#e8f5e0')
    CREAM      = colors.HexColor('#faf8f3')
    MUTED      = colors.HexColor('#5a7060')
    RED        = colors.HexColor('#dc2626')
    BLUE       = colors.HexColor('#2563eb')

    label_style = ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=7,  textColor=MUTED, spaceAfter=1, leading=10)
    value_style = ParagraphStyle('value', fontName='Helvetica-Bold', fontSize=10, textColor=GREEN, spaceAfter=2)
    section_style=ParagraphStyle('section',fontName='Helvetica-Bold',fontSize=8,  textColor=MUTED, spaceAfter=4, leading=12)
    normal_style= ParagraphStyle('norm',  fontName='Helvetica',      fontSize=9,  textColor=GREEN, leading=13)
    footer_style= ParagraphStyle('footer',fontName='Helvetica',      fontSize=7,  textColor=MUTED, alignment=TA_CENTER)
    qr_caption  = ParagraphStyle('qrcap', fontName='Helvetica', fontSize=6, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2, leading=7)
    brand_style = ParagraphStyle('brand', fontName='Helvetica-Bold', fontSize=17, textColor=GREEN, leading=18)

    story = []
    patient = first.patient

    # ── HEADER (once) ──────────────────────────────────────────
    left_block = Table([[
        _logo_mark(30),
        Paragraph(f'MediCloud<br/><font size="8" color="#5a7060">LAB REPORT&nbsp;·&nbsp;Combined ({len(results)} tests)</font>', brand_style),
    ]], colWidths=[36, None])
    left_block.setStyle(TableStyle([
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0),(-1,-1), 0), ('RIGHTPADDING', (0,0),(0,0), 8),
        ('TOPPADDING', (0,0),(-1,-1), 0), ('BOTTOMPADDING', (0,0),(-1,-1), 0),
    ]))
    header_data = [[
        left_block,
        [_qr_drawing(report_view_url(first.id), 2.0), Paragraph('Scan to verify', qr_caption)],
    ]]
    header_table = Table(header_data, colWidths=['74%','26%'])
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), GREEN_LIGHT),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING',    (0,0),(-1,-1), 12), ('BOTTOMPADDING', (0,0),(-1,-1), 12),
        ('LEFTPADDING',   (0,0),(-1,-1), 16), ('RIGHTPADDING',  (0,0),(-1,-1), 16),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'), ('ALIGN', (1,0),(1,0), 'RIGHT'),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#b8ddb8')),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.4*cm))

    # ── PATIENT INFO (once) ─────────────────────────────────────
    report_date = datetime.now().strftime('%d %b %Y, %I:%M %p')
    info_data = [
        [Paragraph('PATIENT NAME', label_style), Paragraph('BARCODE', label_style),
         Paragraph('AGE / GENDER', label_style), Paragraph('DOCTOR', label_style)],
        [Paragraph(patient.patient_name if patient else 'Unknown', value_style),
         Paragraph(first.barcode or '—', value_style),
         Paragraph(f"{patient.age or '—'} / {patient.gender or '—'}" if patient else '—', value_style),
         Paragraph(patient.doctor_name or '—' if patient else '—', value_style)],
        [Paragraph('SAMPLE TYPE', label_style), Paragraph('TESTS INCLUDED', label_style),
         Paragraph('', label_style), Paragraph('REPORT DATE', label_style)],
        [Paragraph(patient.sample_type if patient else '—', value_style),
         Paragraph(str(len(results)), value_style),
         Paragraph('', value_style),
         Paragraph(report_date, value_style)],
    ]
    info_table = Table(info_data, colWidths=['25%','25%','25%','25%'])
    info_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.white),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
        ('GRID',          (0,0),(-1,-1), 0.5, colors.HexColor('#f0f4f0')),
        ('TOPPADDING',    (0,0),(-1,-1), 7), ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('LEFTPADDING',   (0,0),(-1,-1), 10), ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('ROWBACKGROUND', (0,0),(-1,0),  CREAM), ('ROWBACKGROUND', (0,2),(-1,2),  CREAM),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.5*cm))

    # ── ONE SECTION PER RESULT ───────────────────────────────────
    for r in results:
        parsed = r.parsed_data or {}
        story.append(Paragraph(f'TEST RESULTS — {r.test_name or "Result #"+str(r.id)}', section_style))
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
                    Paragraph(p.get('name', p.get('param','')), ParagraphStyle('td', fontName='Helvetica', fontSize=9, textColor=GREEN)),
                    Paragraph(f'<b>{value}</b>', ParagraphStyle('tv', fontName='Helvetica-Bold', fontSize=10, textColor=val_color, alignment=TA_CENTER)),
                    Paragraph(str(p.get('unit','')), ParagraphStyle('tu', fontName='Helvetica', fontSize=9, textColor=MUTED, alignment=TA_CENTER)),
                    Paragraph(ref_range, ParagraphStyle('tr', fontName='Helvetica', fontSize=9, textColor=MUTED, alignment=TA_CENTER)),
                    Paragraph(f'<b>{status_txt}</b>', ParagraphStyle('ts', fontName='Helvetica-Bold', fontSize=8, textColor=val_color, alignment=TA_CENTER)),
                ])
                row_styles.append(('BACKGROUND', (0,row),(-1,row), bg))
            result_table = Table(table_data, colWidths=['35%','15%','15%','20%','15%'])
            result_table.setStyle(TableStyle([
                ('BACKGROUND',    (0,0),(-1,0),  GREEN),
                ('TOPPADDING',    (0,0),(-1,-1), 8), ('BOTTOMPADDING', (0,0),(-1,-1), 8),
                ('LEFTPADDING',   (0,0),(-1,-1), 10), ('RIGHTPADDING',  (0,0),(-1,-1), 10),
                ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
                ('LINEBELOW',     (0,0),(-1,-2), 0.5, colors.HexColor('#e8f5e0')),
                ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
                *row_styles,
            ]))
            story.append(result_table)
        else:
            story.append(Paragraph('No parameters found in this result.', normal_style))
        story.append(Spacer(1, 0.45*cm))

    # ── LEGEND + FOOTER (once) ────────────────────────────────
    legend_data = [[
        Paragraph('<b>Legend:</b>',        ParagraphStyle('leg', fontName='Helvetica-Bold', fontSize=8, textColor=GREEN)),
        Paragraph('↑ HIGH — Above reference range', ParagraphStyle('lh', fontName='Helvetica', fontSize=8, textColor=RED)),
        Paragraph('↓ LOW — Below reference range',  ParagraphStyle('ll', fontName='Helvetica', fontSize=8, textColor=BLUE)),
        Paragraph('Normal — Within reference range', ParagraphStyle('ln', fontName='Helvetica', fontSize=8, textColor=colors.HexColor('#16a34a'))),
    ]]
    legend_table = Table(legend_data, colWidths=['15%','30%','27%','28%'])
    legend_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CREAM),
        ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#d4e6d6')),
        ('TOPPADDING',    (0,0),(-1,-1), 6), ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 10), ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    story.append(legend_table)
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#d4e6d6')))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph(
        f'Generated by MediCloud Lab Middleware · {datetime.now().strftime("%d %b %Y %I:%M %p")} · This report is computer-generated and valid without signature.',
        footer_style
    ))

    doc.build(story)
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
        pdf_bytes = generate_combined_pdf(results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=MediCloud_Combined_{results[0].barcode}.pdf"}
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
        headers={"Content-Disposition": f"attachment; filename=MediCloud_Report_{result_id}.pdf"}
    )
