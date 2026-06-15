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
import io
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

router = APIRouter()


def _render_chromatogram(values, color):
    """Render chromatogram values to a PNG image (in-memory) for the PDF.

    Zooms to the signal (drops the trailing flat baseline) so the curve fills
    the plot like the GH-900 screen, and forces 20-unit x-axis ticks.
    """
    from matplotlib.ticker import MultipleLocator

    # Zoom: trim trailing baseline below 3% of the peak, keep a small margin
    peak = max(values) if values else 0
    view = values
    if peak > 0:
        thresh = peak * 0.03
        last_sig = len(values) - 1
        while last_sig > 0 and values[last_sig] < thresh:
            last_sig -= 1
        margin = max(1, int(len(values) * 0.05))
        view = values[:min(len(values), last_sig + margin + 1)]

    fig, ax = plt.subplots(figsize=(6, 2.2), dpi=120)
    ax.plot(view, color='#dc2626', linewidth=1)
    ax.set_xlim(0, len(view)-1 if len(view) > 1 else 1)
    ax.set_ylim(0, max(view) * 1.1 if view and max(view) > 0 else 1)
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
    header_data = [[
        Paragraph('<b>🔬 MediCloud</b>', ParagraphStyle('logo', fontName='Helvetica-Bold', fontSize=18, textColor=GREEN)),
        Paragraph(f'<b>LAB REPORT</b><br/><font size="8" color="#5a7060">Report #{result.id}</font>',
                  ParagraphStyle('rpt', fontName='Helvetica-Bold', fontSize=12, textColor=GREEN, alignment=TA_RIGHT)),
    ]]
    header_table = Table(header_data, colWidths=['60%','40%'])
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), GREEN_LIGHT),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING',    (0,0),(-1,-1), 12),
        ('BOTTOMPADDING', (0,0),(-1,-1), 12),
        ('LEFTPADDING',   (0,0),(-1,-1), 16),
        ('RIGHTPADDING',  (0,0),(-1,-1), 16),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
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
