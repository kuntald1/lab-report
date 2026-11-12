"""Cost Estimate — a quote, before any sample exists.

A walk-in asks what a panel will cost, or a franchise asks for a rate card.
Nothing here creates a patient, a bill or a sample: it prices a basket of
tests and groups through the same resolver billing uses, applies a discount,
and can send the result over WhatsApp.

Direct / walk-in prices come from the base catalog; a franchise gets its own
group or organization rate, exactly as it would on a real bill.
"""
from typing import Dict, List, Optional
import io
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Franchise, Role
from models.clinical import TestCatalog, Package
from services.pricing import resolve_price, resolve_package_price
from services.whatsapp import send_whatsapp

router = APIRouter()

ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


class EstimateIn(BaseModel):
    organization_id: Optional[int] = None     # None = Direct / walk-in
    test_ids:  List[int] = []
    group_ids: List[int] = []
    discount:  float = 0.0                    # flat rupees off the total (older clients)
    # how many of each line — keyed by the test / group id (as text, JSON keys
    # are strings); anything missing counts as 1
    test_qty:  Dict[str, int] = {}
    group_qty: Dict[str, int] = {}
    discount_type:  Optional[str] = None      # 'flat' (₹) | 'percent'
    discount_value: Optional[float] = None    # when given, wins over `discount`
    patient_name: Optional[str] = None


class SendIn(EstimateIn):
    to_number: Optional[str] = None           # blank = the franchise's own number


def _org_for(scope: Scope, organization_id: Optional[int]) -> Optional[int]:
    """A franchise login can only ever quote its own rates."""
    if scope.role == Role.FRANCHISE:
        return scope.franchise_id
    return organization_id


MAX_QTY = 99


def _qty(table: Dict[str, int], key: int) -> int:
    try:
        q = int(table.get(str(key), table.get(key, 1)))   # type: ignore[arg-type]
    except (TypeError, ValueError):
        q = 1
    return max(1, min(q, MAX_QTY))


def _build(db: Session, p: EstimateIn, scope: Scope) -> dict:
    org_id = _org_for(scope, p.organization_id)
    if org_id is not None and not db.query(Franchise).filter(Franchise.id == org_id).first():
        raise HTTPException(404, "organization not found")

    lines, mrp_total, price_total = [], 0.0, 0.0

    for tid in dict.fromkeys(p.test_ids):          # de-duplicated, order kept
        try:
            rp = resolve_price(db, tid, org_id)
        except ValueError:
            continue
        t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
        q = _qty(p.test_qty, tid)
        lines.append({"kind": "test", "id": tid, "name": t.name if t else f"#{tid}",
                      "mrp": rp.mrp, "price": rp.price, "source": rp.source,
                      "qty": q, "amount": round((rp.price or 0.0) * q, 2)})
        mrp_total += (rp.mrp or 0.0) * q
        price_total += (rp.price or 0.0) * q

    for gid in dict.fromkeys(p.group_ids):
        try:
            rp = resolve_package_price(db, gid, org_id)
        except ValueError:
            continue
        g = db.query(Package).filter(Package.id == gid).first()
        q = _qty(p.group_qty, gid)
        lines.append({"kind": "group", "id": gid, "name": g.name if g else f"#{gid}",
                      "mrp": rp.mrp, "price": rp.price, "source": rp.source,
                      "qty": q, "amount": round((rp.price or 0.0) * q, 2)})
        mrp_total += (rp.mrp or 0.0) * q
        price_total += (rp.price or 0.0) * q

    if not lines:
        raise HTTPException(400, "pick at least one test or group")

    # A discount cannot take the total below zero, and cannot be negative —
    # a typo in that box must not quietly inflate the quote. A percentage is
    # held to 0–100 for the same reason.
    d_type = (p.discount_type or "flat").lower()
    d_value = float(p.discount_value if p.discount_value is not None else (p.discount or 0.0))
    if d_type == "percent":
        d_value = max(0.0, min(d_value, 100.0))
        discount = round(price_total * d_value / 100.0, 2)
    else:
        d_type = "flat"
        discount = d_value
    discount = max(0.0, min(discount, price_total))
    org = db.query(Franchise).filter(Franchise.id == org_id).first() if org_id else None

    return {
        "organization_id": org_id,
        "organization_name": org.name if org else "Direct / Walk-in",
        "organization_phone": getattr(org, "phone", None) if org else None,
        "patient_name": (p.patient_name or "").strip() or None,
        "lines": lines,
        "mrp_total": round(mrp_total, 2),
        "price_total": round(price_total, 2),
        "discount": round(discount, 2),
        "discount_type": d_type,
        "discount_value": round(d_value, 2),
        "payable": round(price_total - discount, 2),
    }


def _message(est: dict, lab_name: str = "Healthycian") -> str:
    """The WhatsApp body. Plain text — it has to read well on a phone."""
    out = [f"*{lab_name} — Cost Estimate*", ""]
    if est["patient_name"]:
        out.append(f"Patient: {est['patient_name']}")
    out.append(f"For: {est['organization_name']}")
    out.append("")
    for ln in est["lines"]:
        label = ln["name"] + (" (group)" if ln["kind"] == "group" else "")
        if ln.get("qty", 1) > 1:
            out.append(f"• {label} — Rs {ln['price']:.0f} × {ln['qty']} = Rs {ln['amount']:.0f}")
        else:
            out.append(f"• {label} — Rs {ln['price']:.0f}")
    out.append("")
    out.append(f"Total: Rs {est['price_total']:.0f}")
    if est["discount"]:
        pct = f" ({est['discount_value']:g}%)" if est.get("discount_type") == "percent" else ""
        out.append(f"Discount{pct}: Rs {est['discount']:.0f}")
        out.append(f"*Payable: Rs {est['payable']:.0f}*")
    else:
        out.append(f"*Payable: Rs {est['payable']:.0f}*")
    out.append("")
    out.append("This is an estimate, not a bill. Prices may change.")
    return "\n".join(out)


@router.post("/quote")
def quote(p: EstimateIn, db: Session = Depends(get_db),
          user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    """Price a basket. Creates nothing."""
    est = _build(db, p, scope)
    est["message"] = _message(est)
    return est


@router.post("/send")
def send(p: SendIn, request: Request, db: Session = Depends(get_db),
         user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    """Send the estimate on WhatsApp.

    With no number, a franchise estimate goes to the franchise's own number —
    the "send straight to them" case. A Direct estimate always needs a number,
    because a walk-in has no number on file yet.
    """
    est = _build(db, p, scope)
    to = (p.to_number or "").strip() or est["organization_phone"]
    if not to:
        raise HTTPException(400, "no WhatsApp number — type one, or set a phone on the organization")

    body = _message(est)
    res = send_whatsapp(db, user.tenant_id, to, body)
    write_audit(db, action="estimate_sent", user=user, entity="estimate", entity_id=None,
                after={"to": to, "payable": est["payable"], "lines": len(est["lines"]),
                       "ok": bool(res.get("ok"))},
                ip=request.client.host if request.client else None)
    if not res.get("ok"):
        raise HTTPException(502, f"WhatsApp failed: {res.get('error', 'unknown error')}")
    return {"ok": True, "to": to, "payable": est["payable"], "sid": res.get("sid")}


# ----------------------------------------------------------------- PDF
def _estimate_pdf(db: Session, est: dict, tenant_id: Optional[int]) -> bytes:
    """The estimate on the lab's letterhead — the same logo/address header,
    faint watermark and teal footer band as the lab report, so it reads as
    the lab's own document. Clearly marked as an estimate, not a bill."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from models.org import Tenant
    from services.report_settings import get_report_settings
    from routers.pdf import _logo_image, _ICON_PATH, _wrap_text

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first() if tenant_id else None
    cfg = get_report_settings(tenant)

    BLACK, GREEN, MUTED = colors.HexColor('#1a1a1a'), colors.HexColor('#0e7d6b'), colors.HexColor('#5c7370')
    BORDER, TEAL_FOOT, ORANGE = colors.HexColor('#d8d8d8'), colors.HexColor('#0b4d3e'), colors.HexColor('#c2410c')
    st = lambda name, **kw: ParagraphStyle(name, **{"fontName": "Helvetica", "fontSize": 9, "textColor": BLACK, "leading": 12, **kw})
    addr, addr_b = st('a', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10), st('ab', fontName='Helvetica-Bold', fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT, leading=10)
    label, value = st('l', fontName='Helvetica-Bold', fontSize=7, textColor=MUTED, leading=9), st('v', fontName='Helvetica-Bold', fontSize=9.5, leading=12)
    title = st('t', fontName='Helvetica-Bold', fontSize=14, textColor=GREEN, leading=18)
    cell, cell_r = st('c'), st('cr', alignment=TA_RIGHT)
    head, head_r = st('h', fontName='Helvetica-Bold', fontSize=8, textColor=MUTED), st('hr', fontName='Helvetica-Bold', fontSize=8, textColor=MUTED, alignment=TA_RIGHT)
    note = st('n', fontSize=7.5, textColor=MUTED, alignment=TA_CENTER)
    rs = lambda n: "Rs " + f"{(n or 0):,.2f}"

    # footer band sized to its content (same approach as the report)
    PAGE_W = A4[0]
    FL_X, FL_W, FR_W = 1.5*cm, 4.6*cm, 2.4*cm
    FC_X0 = FL_X + FL_W + 0.4*cm
    FC_W = PAGE_W - 1.5*cm - FR_W - FC_X0
    left_lines = ['A UNIT OF'] + _wrap_text(cfg['unit_of'], 'Helvetica', 6.5, FL_W, max_lines=2)
    center_lines = (_wrap_text('Reg. Office & Centralised Lab: ' + ' '.join(cfg['address_lines']), 'Helvetica-Bold', 6.5, FC_W, max_lines=2)
                    + _wrap_text(' / '.join(cfg['phones']), 'Helvetica', 6.5, FC_W, max_lines=1)
                    + _wrap_text(f"{cfg['email']}   {cfg['website']}", 'Helvetica', 6.5, FC_W, max_lines=1))
    LINE_H = 0.38*cm
    FOOT_H = max(len(left_lines), len(center_lines)) * LINE_H + 0.55*cm

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5*cm, rightMargin=1.5*cm,
                            topMargin=1.5*cm, bottomMargin=FOOT_H + 0.6*cm,
                            title=f"{cfg['lab_name']} Cost Estimate")
    story = []

    # letterhead
    addr_block = [Paragraph('<b>Reg. Office &amp; Centralised Lab:</b>', addr_b)]
    addr_block += [Paragraph(l, addr) for l in cfg['address_lines']]
    addr_block += [Paragraph(' / '.join(cfg['phones']), addr), Paragraph(cfg['email'], addr)]
    ht = Table([[_logo_image(cfg, 5.2), addr_block]], colWidths=['52%', '48%'])
    ht.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP')] + [(k, (0,0), (-1,-1), 0) for k in ('LEFTPADDING','RIGHTPADDING','TOPPADDING','BOTTOMPADDING')]))
    story += [ht, Spacer(1, 0.2*cm), HRFlowable(width='100%', thickness=1.4, color=GREEN), Spacer(1, 0.45*cm)]

    # who / when
    story.append(Paragraph('COST ESTIMATE', title))
    story.append(Spacer(1, 0.25*cm))
    def kv(pairs):
        rows = []
        for k, v in pairs:
            rows += [[Paragraph(k, label)], [Paragraph(str(v) if v not in (None, '') else '—', value)]]
        t = Table(rows, colWidths=['100%'])
        t.setStyle(TableStyle([(k, (0,0), (-1,-1), 0) for k in ('LEFTPADDING','RIGHTPADDING','TOPPADDING','BOTTOMPADDING')]))
        return t
    info = Table([[kv([('PATIENT NAME', est.get('patient_name')), ('ESTIMATE FOR', est['organization_name'])]),
                   kv([('DATE', datetime.now(ZoneInfo('Asia/Kolkata')).strftime('%d %b %Y, %I:%M %p')), ('ITEMS', len(est['lines']))])]],
                 colWidths=['55%', '45%'])
    info.setStyle(TableStyle([('BOX', (0,0), (-1,-1), 1, BORDER), ('LINEAFTER', (0,0), (0,0), 0.5, BORDER),
                              ('VALIGN', (0,0), (-1,-1), 'TOP'),
                              ('TOPPADDING', (0,0), (-1,-1), 9), ('BOTTOMPADDING', (0,0), (-1,-1), 9),
                              ('LEFTPADDING', (0,0), (-1,-1), 12), ('RIGHTPADDING', (0,0), (-1,-1), 12)]))
    story += [info, Spacer(1, 0.5*cm)]

    # lines
    data = [[Paragraph('#', head), Paragraph('TEST / GROUP', head), Paragraph('RATE', head_r),
             Paragraph('QTY', head_r), Paragraph('AMOUNT', head_r)]]
    for i, ln in enumerate(est['lines'], 1):
        name = ln['name'] + ('  <font size="6.5" color="#c2410c"><b>GROUP</b></font>' if ln['kind'] == 'group' else '')
        data.append([Paragraph(str(i), cell), Paragraph(name, cell), Paragraph(rs(ln['price']), cell_r),
                     Paragraph(str(ln.get('qty', 1)), cell_r), Paragraph(rs(ln.get('amount', ln['price'])), cell_r)])
    lt = Table(data, colWidths=[0.8*cm, None, 2.8*cm, 1.4*cm, 3.0*cm], repeatRows=1)
    lt.setStyle(TableStyle([('LINEBELOW', (0,0), (-1,0), 1.2, BLACK),
                            ('LINEBELOW', (0,1), (-1,-1), 0.4, BORDER),
                            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                            ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6)]))
    story += [lt, Spacer(1, 0.35*cm)]

    # totals, right-aligned
    tot = []
    if est['mrp_total'] > est['price_total']:
        tot.append(['MRP total', rs(est['mrp_total'])])
    tot.append(['Price total', rs(est['price_total'])])
    if est['discount']:
        pct = f" ({est['discount_value']:g}%)" if est.get('discount_type') == 'percent' else ''
        tot.append([f'Discount{pct}', '- ' + rs(est['discount'])])
    tot.append(['PAYABLE', rs(est['payable'])])
    tt = Table([[Paragraph(a, st('tk', alignment=TA_RIGHT, textColor=MUTED if a != 'PAYABLE' else BLACK, fontName='Helvetica-Bold' if a == 'PAYABLE' else 'Helvetica')),
                 Paragraph(b, st('tv', alignment=TA_RIGHT, fontName='Helvetica-Bold', fontSize=12 if a == 'PAYABLE' else 9, textColor=ORANGE if a == 'PAYABLE' else BLACK, leading=15 if a == 'PAYABLE' else 12))]
                for a, b in tot], colWidths=[None, 3.4*cm], hAlign='RIGHT')
    tt.setStyle(TableStyle([('LINEABOVE', (0, len(tot)-1), (-1, len(tot)-1), 1.2, BLACK),
                            ('TOPPADDING', (0,0), (-1,-1), 3), ('BOTTOMPADDING', (0,0), (-1,-1), 3)]))
    wrap = Table([['', tt]], colWidths=[None, 9*cm])
    wrap.setStyle(TableStyle([(k, (0,0), (-1,-1), 0) for k in ('LEFTPADDING','RIGHTPADDING','TOPPADDING','BOTTOMPADDING')]))
    story += [wrap, Spacer(1, 0.9*cm),
              Paragraph('This is an estimate, not a bill. Prices may change. No sample has been collected.', note)]

    def chrome(c, d):
        c.saveState()
        try:
            iw, ih = ImageReader(_ICON_PATH).getSize()
            w = 8.5*cm; h = w * ih / iw
            c.saveState(); c.setFillAlpha(0.05)
            c.drawImage(_ICON_PATH, (A4[0]-w)/2, (A4[1]-h)/2, width=w, height=h, mask='auto', preserveAspectRatio=True)
            c.restoreState()
        except Exception:
            pass
        c.setFillColor(TEAL_FOOT); c.rect(0, 0, A4[0], FOOT_H, stroke=0, fill=1)
        c.setFillColor(colors.white)
        y = FOOT_H - 0.45*cm
        c.setFont('Helvetica-Bold', 7); c.drawString(FL_X, y, left_lines[0])
        c.setFont('Helvetica', 6.5)
        for line in left_lines[1:]:
            y -= LINE_H; c.drawString(FL_X, y, line)
        cy = FOOT_H - 0.45*cm
        for i, line in enumerate(center_lines):
            c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 6.5)
            c.drawCentredString(FC_X0 + FC_W/2, cy, line); cy -= LINE_H
        c.setFont('Helvetica', 7); c.drawRightString(A4[0] - 1.5*cm, FOOT_H - 0.6*cm, f"Page {d.page}")
        c.restoreState()

    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    return buf.getvalue()


@router.post("/pdf")
def estimate_pdf(p: EstimateIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    """The estimate as a PDF on the lab's letterhead. Creates nothing."""
    est = _build(db, p, scope)
    pdf = _estimate_pdf(db, est, getattr(user, "tenant_id", None))
    fname = "Estimate_" + "".join(ch for ch in (est.get("patient_name") or "quote") if ch.isalnum() or ch in "-_") + ".pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})

