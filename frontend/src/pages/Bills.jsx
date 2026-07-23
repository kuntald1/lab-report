import { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.55rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.66rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { maximumFractionDigits:2 });
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';

const statusStyle = { paid:['#16a34a','Paid'], partial:['#f59e0b','Partial'], unpaid:['#dc2626','Unpaid'], credit:['#6366f1','On Credit'] };

export default function Bills() {
  const [bills, setBills]       = useState([]);
  const [orgs, setOrgs]         = useState([]);
  const [branches, setBranches] = useState([]);
  const [f, setF]               = useState({ organization_id:'', branch_id:'', barcode:'', patient_id:'', date_from:'', date_to:'' });
  const [loading, setLoading]   = useState(false);
  const [detail, setDetail]     = useState(null);     // bill open in modal
  const [payAmt, setPayAmt]     = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [discType, setDiscType] = useState('');
  const [discVal, setDiscVal]   = useState('');
  const [discBusy, setDiscBusy] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [waLink, setWaLink]     = useState(true);
  const [waSending, setWaSending] = useState(false);
  const [waDone, setWaDone]     = useState(null);   // success popup payload
  const [waiting, setWaiting]   = useState(false);
  const pollRef = useState({ current: null })[0];
  const [toast, setToast]       = useState(null);
  const [accEdit, setAccEdit]   = useState({});   // {item_id: draft value} while editing accession no.
  const [accBusy, setAccBusy]   = useState(null); // item_id currently saving

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  const saveAccession = async (itemId) => {
    if (!detail || !(itemId in accEdit)) return;
    const val = accEdit[itemId].trim();
    if (!val) return showToast('error', 'Accession No. cannot be blank');
    setAccBusy(itemId);
    try {
      const res = await authedFetch(`/billing/bills/${detail.id}/items/${itemId}/accession`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accession_number: val }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const updated = await res.json();
      setDetail(updated);
      setAccEdit(prev => { const n = { ...prev }; delete n[itemId]; return n; });
      load();
    } catch (e) { showToast('error', String(e.message||'Save failed')); }
    setAccBusy(null);
  };

  const printSamples = () => {
    if (!detail) return;
    const rows = (detail.items||[]).filter(it => it.accession_number);
    if (rows.length === 0) return showToast('error', 'No accession numbers to print');
    const w = window.open('', '_blank', 'width=480,height=640');
    w.document.write(`<!doctype html><html><head><title>${detail.bill_no} · Sample Labels</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
      <style>
        body{font-family:Arial,sans-serif;margin:0;padding:0.4rem;}
        .label{width:100%;padding:0.5rem 0.3rem;border-bottom:1px dashed #999;page-break-inside:avoid;text-align:center;}
        .pname{font-size:0.75rem;font-weight:700;margin:0 0 0.15rem;}
        .tname{font-size:0.68rem;color:#333;margin:0 0 0.2rem;}
        svg{max-width:100%;}
        @media print{ .label{border-bottom:1px dashed #ccc;} }
      </style></head><body>
      ${rows.map(it => `<div class="label">
          <div class="pname">${detail.patient_name || ''}</div>
          <div class="tname">${it.package_name || it.test_name}</div>
          <svg class="bc" data-code="${it.accession_number}"></svg>
        </div>`).join('')}
      <script>
        window.onload = function(){
          document.querySelectorAll('.bc').forEach(function(el){
            JsBarcode(el, el.getAttribute('data-code'), { format:'CODE128', height:40, fontSize:12, margin:4 });
          });
          setTimeout(function(){ window.print(); }, 300);
        };
      </script>
      </body></html>`);
    w.document.close();
  };

  // load the Razorpay checkout script once
  useEffect(() => {
    if (document.getElementById('rzp-sdk')) return;
    const s = document.createElement('script');
    s.id = 'rzp-sdk'; s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    document.body.appendChild(s);
  }, []);

  const payWithRazorpay = async (bill) => {
    try {
      const ordRes = await authedFetch(`/billing/bills/${bill.id}/razorpay/order`, { method:'POST' });
      if (!ordRes.ok) { const e = await ordRes.json().catch(()=>({})); throw new Error(e.detail||'order failed'); }
      const ord = await ordRes.json();
      if (!window.Razorpay) return showToast('error', 'Razorpay not loaded — retry in a moment');
      const rzp = new window.Razorpay({
        key: ord.key_id, order_id: ord.order_id, amount: ord.amount, currency: ord.currency,
        name: ord.name, description: ord.description,
        handler: async (resp) => {
          try {
            const vRes = await authedFetch(`/billing/bills/${bill.id}/razorpay/verify`, { method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) });
            if (!vRes.ok) { const e = await vRes.json().catch(()=>({})); throw new Error(e.detail||'verify failed'); }
            const updated = await authedFetch(`/billing/bills/${bill.id}`).then(r=>r.json());
            setDetail(updated); load();
            showToast('success', 'Razorpay payment verified');
            sendReceiptWA(updated);
          } catch (e) { showToast('error', String(e.message||'Verify failed')); }
        },
        modal: { ondismiss: () => showToast('error', 'Payment cancelled') },
        theme: { color: '#f97316' },
      });
      rzp.open();
    } catch (e) { showToast('error', String(e.message||'Razorpay failed')); }
  };

  const load = () => {
    setLoading(true);
    const qs = Object.entries(f).filter(([,v])=>v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    authedFetch(`/billing/bills${qs?`?${qs}`:''}`).then(r=>r.ok?r.json():[]).then(d=>{ setBills(d); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(() => {
    load();
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
  }, []);   // eslint-disable-line

  const openBill = (b) => { setDetail(b); setPayAmt(String(Math.max(0,(b.total||0)-(b.paid||0)))); setPayMethod('cash'); setWaNumber(b.phone||''); setWaLink(true); setDiscType(b.discount_type||''); setDiscVal(b.discount_value?String(b.discount_value):''); };

  const applyDiscount = async () => {
    if (!detail) return;
    setDiscBusy(true);
    try {
      const res = await authedFetch(`/billing/bills/${detail.id}/discount`, { method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ discount_type: discType || null, discount_value: Number(discVal)||0 }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const updated = await res.json();
      setDetail(updated); setPayAmt(String(Math.max(0,(updated.total||0)-(updated.paid||0)))); load();
      showToast('success', 'Discount applied');
    } catch (e) { showToast('error', String(e.message||'Discount failed')); }
    setDiscBusy(false);
  };

  const sendWhatsApp = async () => {
    if (!detail) return;
    if (!waNumber.trim()) return showToast('error', 'Enter the patient\u2019s WhatsApp number');
    setWaSending(true);
    try {
      const res = await authedFetch(`/billing/bills/${detail.id}/send-whatsapp`, { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ to_number: waNumber.trim(), include_payment_link: waLink, save_patient_phone: true }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const out = await res.json();
      setWaDone({ number: waNumber.trim(), bill: detail.bill_no, link: out.payment_link });
      if (out.plink_id && waLink) startPolling(out.plink_id, detail.id);
      if (waLink && !out.payment_link && out.payment_link_skipped_reason) {
        showToast('error', `Bill sent, but payment link was skipped: ${out.payment_link_skipped_reason}`);
      }
    } catch (e) { showToast('error', String(e.message||'WhatsApp failed')); }
    setWaSending(false);
  };

  const startPolling = (plinkId, billId) => {
    setWaiting(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await authedFetch(`/billing/payment-link/${plinkId}/status`);
        if (!r.ok) return;
        const st = await r.json();
        if (st.paid) {
          clearInterval(pollRef.current); pollRef.current = null;
          setWaiting(false);
          const updated = await authedFetch(`/billing/bills/${billId}`).then(x=>x.json()).catch(()=>null);
          if (updated) setDetail(updated);
          load();
          showToast('success', 'Payment received · status updated to Paid');
          if (updated) downloadReceipt({ id: billId, bill_no: updated.bill_no });
        }
      } catch { /* keep polling */ }
    }, 4000);
  };

  const stopWaiting = () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; setWaiting(false); };
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);   // eslint-disable-line
  const sendReceiptWA = async (bill) => {
    const num = (waNumber && waNumber.trim()) || bill?.phone || '';
    if (!num) return;   // no number → skip silently
    try {
      await authedFetch(`/billing/bills/${bill.id}/send-receipt`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to_number: num }) });
      showToast('success', 'Money receipt sent on WhatsApp');
    } catch { /* non-blocking */ }
  };

  const takePayment = async () => {
    if (!detail) return;
    if (payMethod === 'razorpay') return payWithRazorpay(detail);
    const amt = Number(payAmt)||0;
    if (amt <= 0) return showToast('error', 'Enter an amount');
    try {
      const res = await authedFetch(`/billing/bills/${detail.id}/payments`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ method:payMethod, amount:amt }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const updated = await res.json();
      setDetail(updated); load();
      showToast('success', `Payment recorded · ${inr(amt)}`);
      sendReceiptWA(updated);
    } catch (e) { showToast('error', String(e.message||'Payment failed')); }
  };

  const downloadPdf = async (b) => {
    try {
      const res = await authedFetch(`/billing/bills/${b.id}/pdf`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${b.bill_no}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast('error', 'PDF download failed'); }
  };

  const downloadReceipt = async (b) => {
    try {
      const res = await authedFetch(`/billing/bills/${b.id}/receipt`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `Receipt_${b.bill_no}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast('error', 'Receipt download failed'); }
  };

  const due = (b) => Math.max(0, (b.total||0) - (b.paid||0));

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}`, animation:'toastIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='success'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)' }}>{toast.kind==='success'?'✓':'✕'}</div>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(40px);} to { opacity:1; transform:translateX(0);} } @keyframes spin { to { transform: rotate(360deg);} }`}</style>

      {waDone && (
        <div onClick={()=>setWaDone(null)} style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(15,18,24,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'18px', padding:'2rem', width:'380px', maxWidth:'92vw', textAlign:'center', boxShadow:'0 24px 70px rgba(15,18,24,0.35)' }}>
            <div style={{ width:'64px', height:'64px', borderRadius:'50%', background:'rgba(37,211,102,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2rem', margin:'0 auto 1rem' }}>💬</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.25rem', fontWeight:800, color:'#0f1218' }}>Sent on WhatsApp</div>
            <div style={{ color:'#8892a4', fontSize:'0.86rem', marginTop:'0.4rem', lineHeight:1.5 }}>
              Bill <strong style={{ color:'#0f1218' }}>{waDone.bill}</strong> was sent to <strong style={{ color:'#0f1218' }}>{waDone.number}</strong>.
              {waDone.link && <div style={{ marginTop:'0.5rem' }}>A payment link was included — the final bill will reflect payment once they pay.</div>}
            </div>
            <button onClick={()=>setWaDone(null)} style={{ marginTop:'1.5rem', width:'100%', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Done</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Billing</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Bills</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{bills.length} bills</p>
      </div>

      {/* filters */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:'0.7rem', alignItems:'end' }}>
          <div><label style={lbl}>Organization</label>
            <select style={inp} value={f.organization_id} onChange={e=>setF({...f,organization_id:e.target.value})}>
              <option value="">All</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <div><label style={lbl}>Branch</label>
            <select style={inp} value={f.branch_id} onChange={e=>setF({...f,branch_id:e.target.value})}>
              <option value="">All</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div><label style={lbl}>From</label><input style={inp} type="date" value={f.date_from} onChange={e=>setF({...f,date_from:e.target.value})} /></div>
          <div><label style={lbl}>To</label><input style={inp} type="date" value={f.date_to} onChange={e=>setF({...f,date_to:e.target.value})} /></div>
          <div><label style={lbl}>Patient ID</label><input style={inp} type="number" placeholder="id" value={f.patient_id} onChange={e=>setF({...f,patient_id:e.target.value})} /></div>
          <div><label style={lbl}>Barcode</label><input style={inp} placeholder="barcode" value={f.barcode} onChange={e=>setF({...f,barcode:e.target.value})} /></div>
        </div>
        <div style={{ display:'flex', gap:'0.6rem', marginTop:'1rem' }}>
          <button onClick={load} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.4rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply Filters</button>
          <button onClick={()=>{ setF({ organization_id:'', branch_id:'', barcode:'', patient_id:'', date_from:'', date_to:'' }); setTimeout(load,0); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
        </div>
      </div>

      {/* table */}
      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Bill No','Patient','Billed To','Total','Paid','Due','Status','Date','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.75rem 1.1rem', fontSize:'0.64rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>{loading?'Loading…':'No bills match.'}</td></tr>}
            {bills.map(b => {
              const [sc, slabel] = statusStyle[b.status] || ['#64748b', b.status];
              return (
                <tr key={b.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{ padding:'0.8rem 1.1rem', fontWeight:700, color:'#0f1218', fontSize:'0.82rem', fontFamily:'monospace' }}>{b.bill_no}</td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.83rem', color:'#0f1218' }}>{b.patient_name}<div style={{ color:'#8892a4', fontSize:'0.72rem', fontFamily:'monospace' }}>{b.barcode}</div></td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.82rem', color: b.organization_name?'#6366f1':'#8892a4' }}>{b.organization_name || 'Direct'}</td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.83rem', fontWeight:600 }}>{inr(b.total)}</td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.83rem', color:'#16a34a' }}>{inr(b.paid)}</td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.83rem', color: due(b)>0?'#dc2626':'#8892a4', fontWeight:600 }}>{inr(due(b))}</td>
                  <td style={{ padding:'0.8rem 1.1rem' }}><span style={{ background:sc+'18', color:sc, padding:'0.2rem 0.6rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:700 }}>{slabel}</span></td>
                  <td style={{ padding:'0.8rem 1.1rem', fontSize:'0.76rem', color:'#8892a4' }}>{fmtDate(b.created_at)}</td>
                  <td style={{ padding:'0.8rem 1.1rem' }}>
                    <div style={{ display:'flex', gap:'0.35rem' }}>
                      <button title="View / Pay" onClick={()=>openBill(b)} style={iconBtn('#2563eb')}>👁</button>
                      <button title="Download Receipt" onClick={()=>downloadReceipt(b)} style={iconBtn('#f97316')}>⬇</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* detail + payment modal */}
      {detail && (
        <div onClick={()=>setDetail(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'520px', maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
              <div>
                <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.2rem', color:'#0f1218' }}>{detail.bill_no}</div>
                <div style={{ color:'#8892a4', fontSize:'0.82rem' }}>{detail.patient_name} · {detail.barcode}</div>
                <div style={{ color: detail.organization_name?'#6366f1':'#8892a4', fontSize:'0.82rem', fontWeight:600 }}>{detail.organization_name || 'Direct / Walk-in'}</div>
              </div>
              <div style={{ display:'flex', alignItems:'flex-start', gap:'0.5rem' }}>
                <button title="Print sample labels" onClick={printSamples} style={{ background:'rgba(37,99,235,0.1)', color:'#2563eb', border:'1px solid rgba(37,99,235,0.25)', borderRadius:'8px', padding:'0.4rem 0.7rem', fontWeight:700, cursor:'pointer', fontSize:'0.72rem', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>🖨 Print Samples</button>
                <button onClick={()=>setDetail(null)} style={{ border:'none', background:'transparent', fontSize:'1.4rem', color:'#c4cad6', cursor:'pointer' }}>×</button>
              </div>
            </div>

            <div style={{ border:'1px solid #f4f6fa', borderRadius:'10px', overflow:'hidden', marginBottom:'1rem' }}>
              {(() => {
                const gmap = {}; const standalone = [];
                detail.items.forEach(it => {
                  if (it.package_id) {
                    if (!gmap[it.package_id]) gmap[it.package_id] = { name: it.package_name || 'Group', price: 0, members: [] };
                    gmap[it.package_id].price += (Number(it.price)||0);
                    gmap[it.package_id].members.push(it);
                  } else standalone.push(it);
                });
                return (<>
                  {Object.entries(gmap).map(([pid, g]) => (
                    <div key={'g'+pid} style={{ borderBottom:'1px solid #f7f8fb', padding:'0.5rem 0.9rem' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem' }}>
                        <span style={{ fontWeight:700, color:'#0f1218' }}>{g.name} <span style={{ fontSize:'0.6rem', background:'rgba(249,115,22,0.12)', color:'#c2410c', padding:'0.1rem 0.45rem', borderRadius:'20px', fontWeight:700 }}>GROUP</span></span>
                        <span style={{ fontWeight:700 }}>{inr(g.price)}</span>
                      </div>
                      <div style={{ paddingLeft:'0.5rem', marginTop:'0.25rem' }}>
                        {g.members.map((m,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'0.74rem', color:'#8892a4', padding:'0.1rem 0' }}>
                            <span>• {m.test_name}</span>
                            <AccessionField it={m} accEdit={accEdit} setAccEdit={setAccEdit} accBusy={accBusy} onSave={saveAccession} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {standalone.map((it,i) => (
                    <div key={i} style={{ padding:'0.5rem 0.9rem', borderBottom:'1px solid #f7f8fb', fontSize:'0.83rem' }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span>{it.test_name} <span style={{ fontSize:'0.65rem', color:'#8892a4' }}>({it.price_source})</span></span>
                        <span style={{ fontWeight:600 }}>{inr(it.price)}</span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'0.2rem' }}>
                        <AccessionField it={it} accEdit={accEdit} setAccEdit={setAccEdit} accBusy={accBusy} onSave={saveAccession} />
                      </div>
                    </div>
                  ))}
                </>);
              })()}
            </div>

            <div style={{ fontSize:'0.85rem' }}>
              <Row k="Subtotal" v={inr(detail.subtotal)} />
              {detail.discount_amount>0 && <Row k="Discount" v={'– '+inr(detail.discount_amount)} color="#dc2626" />}
              <Row k="Total" v={inr(detail.total)} bold />
              <Row k="Paid" v={inr(detail.paid)} color="#16a34a" />
              <Row k="Due" v={inr(Math.max(0,detail.total-detail.paid))} color="#dc2626" bold />
            </div>

            {detail.payments?.length > 0 && (
              <div style={{ marginTop:'0.8rem', fontSize:'0.78rem', color:'#8892a4' }}>
                Payments: {detail.payments.map(p=>`${p.method} ${inr(p.amount)}`).join(' · ')}
              </div>
            )}

            {/* discount (admin, only before any payment) */}
            {(detail.paid||0) <= 0 && detail.status !== 'credit' && (
              <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
                <label style={lbl}>Discount (admin only)</label>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <select style={{ ...inp, width:'130px' }} value={discType} onChange={e=>setDiscType(e.target.value)}>
                    <option value="">No discount</option>
                    <option value="flat">Flat ₹</option>
                    <option value="percent">Percent %</option>
                  </select>
                  <input style={{ ...inp, width:'110px' }} type="number" disabled={!discType} placeholder={discType==='percent'?'%':'₹'} value={discVal} onChange={e=>setDiscVal(e.target.value)} />
                  <button onClick={applyDiscount} disabled={discBusy} style={{ background:'#0f1218', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>{discBusy?'…':'Apply'}</button>
                </div>
              </div>
            )}

            {/* take payment */}
            {Math.max(0,detail.total-detail.paid) > 0 && detail.status !== 'credit' && (
              <div style={{ marginTop:'1.2rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
                <label style={lbl}>Take payment</label>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <select style={{ ...inp, width:'120px' }} value={payMethod} onChange={e=>setPayMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="razorpay">Razorpay</option>
                  </select>
                  <input style={{ ...inp, flex:1, ...(payMethod==='razorpay'?{ background:'#f1f3f7', color:'#8892a4' }:{}) }} type="number"
                    value={payMethod==='razorpay' ? String(Math.max(0,(detail.total||0)-(detail.paid||0))) : payAmt}
                    disabled={payMethod==='razorpay'}
                    onChange={e=>setPayAmt(e.target.value)} />
                  <button onClick={takePayment} style={{ background: payMethod==='razorpay' ? '#3b82f6' : '#16a34a', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>
                    {payMethod==='razorpay' ? 'Pay Online' : 'Record'}
                  </button>
                </div>
              </div>
            )}

            {/* send via WhatsApp */}
            <div style={{ marginTop:'1.2rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
              <label style={lbl}>Send bill on WhatsApp</label>
              <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.5rem' }}>
                <input style={{ ...inp, flex:1 }} placeholder="Patient WhatsApp number (e.g. 98xxxxxxxx)" value={waNumber} onChange={e=>setWaNumber(e.target.value)} />
                <button onClick={sendWhatsApp} disabled={waSending} style={{ background:'#25D366', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>
                  {waSending ? 'Sending…' : '💬 Send'}
                </button>
              </div>
              {Math.max(0,detail.total-detail.paid) > 0 && (
                <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.8rem', color:'#475569', cursor:'pointer' }}>
                  <input type="checkbox" checked={waLink} onChange={e=>setWaLink(e.target.checked)} style={{ accentColor:'#f97316', width:'15px', height:'15px' }} />
                  Include a payment link (patient can pay online)
                </label>
              )}
              {waiting && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'0.7rem', background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.2)', borderRadius:'9px', padding:'0.6rem 0.9rem' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:'0.5rem', color:'#7c3aed', fontWeight:700, fontSize:'0.82rem' }}>
                    <span style={{ width:'14px', height:'14px', border:'2px solid #c4b5fd', borderTopColor:'#7c3aed', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite' }} />
                    Waiting for customer payment…
                  </span>
                  <button onClick={stopWaiting} style={{ background:'transparent', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'7px', padding:'0.3rem 0.8rem', fontSize:'0.78rem', cursor:'pointer' }}>Stop</button>
                </div>
              )}
            </div>

            <button onClick={()=>downloadReceipt(detail)} style={{ width:'100%', marginTop:'1.2rem', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>⬇ Download Money Receipt</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessionField({ it, accEdit, setAccEdit, accBusy, onSave }) {
  const editing = it.id in accEdit;
  const val = editing ? accEdit[it.id] : (it.accession_number || '');
  if (!editing) {
    return (
      <span onClick={()=>setAccEdit(prev=>({ ...prev, [it.id]: it.accession_number || '' }))}
        title="Click to edit accession no." style={{ cursor:'pointer', fontFamily:'monospace', fontSize:'0.7rem', color:'#c2410c', background:'rgba(249,115,22,0.08)', border:'1px dashed rgba(249,115,22,0.3)', borderRadius:'5px', padding:'0.05rem 0.4rem' }}>
        {it.accession_number || '— set accession no.'}
      </span>
    );
  }
  return (
    <span style={{ display:'inline-flex', gap:'0.3rem', alignItems:'center' }}>
      <input autoFocus value={val} onChange={e=>setAccEdit(prev=>({ ...prev, [it.id]: e.target.value }))}
        onKeyDown={e=>{ if (e.key==='Enter') onSave(it.id); if (e.key==='Escape') setAccEdit(prev=>{ const n={...prev}; delete n[it.id]; return n; }); }}
        style={{ fontFamily:'monospace', fontSize:'0.7rem', border:'1.5px solid #f97316', borderRadius:'5px', padding:'0.1rem 0.35rem', width:'90px' }} />
      <button onClick={()=>onSave(it.id)} disabled={accBusy===it.id} style={{ border:'none', background:'#16a34a', color:'#fff', borderRadius:'4px', width:'20px', height:'20px', fontSize:'0.65rem', cursor:'pointer' }}>✓</button>
    </span>
  );
}

function Row({ k, v, color, bold }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'0.2rem 0' }}>
      <span style={{ color:'#8892a4', fontWeight: bold?700:400 }}>{k}</span>
      <span style={{ color: color||'#0f1218', fontWeight: bold?800:600 }}>{v}</span>
    </div>
  );
}

function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33', fontSize:'0.9rem' };
}
