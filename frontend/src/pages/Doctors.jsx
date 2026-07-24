import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '../services/auth';

const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium' }) : '—';
const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', boxSizing:'border-box' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };

function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}

export default function Doctors() {
  const [doctors, setDoctors]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState(null);   // {id?, name, phone, commission_percent}
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  // ledger view
  const [selected, setSelected] = useState(null);   // the doctor row currently drilled into
  const [ledger, setLedger]     = useState(null);   // 'loading' | payload | null
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [paying, setPaying]     = useState(false);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  const load = () => {
    setLoading(true);
    authedFetch('/commission/doctors').then(r=>r.ok?r.json():[]).then(d=>{ setDoctors(Array.isArray(d)?d:[]); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const fetchLedger = (doctorId, df, dt) => {
    setLedger('loading');
    const qs = new URLSearchParams();
    if (df) qs.set('date_from', df);
    if (dt) qs.set('date_to', dt);
    authedFetch(`/commission/doctors/${doctorId}/ledger?${qs.toString()}`)
      .then(r=>r.ok?r.json():null).then(setLedger).catch(()=>setLedger(null));
  };

  const openLedger = (doc) => { setSelected(doc); setDateFrom(''); setDateTo(''); fetchLedger(doc.id, '', ''); };
  const closeLedger = () => { setSelected(null); setLedger(null); };
  const applyDates  = () => fetchLedger(selected.id, dateFrom, dateTo);
  const clearDates  = () => { setDateFrom(''); setDateTo(''); fetchLedger(selected.id, '', ''); };

  const [uploadingSig, setUploadingSig] = useState(false);
  const sigInputRef = useRef(null);

  const openNew  = () => setForm({ name:'', phone:'', commission_percent:'', qualification:'', registration_no:'' });
  const openEdit = (d) => setForm({ id:d.id, name:d.name, phone:d.phone, commission_percent:d.commission_percent,
                                     qualification:d.qualification||'', registration_no:d.registration_no||'', signature_url:d.signature_url||null });

  const [del, setDel] = useState(null);   // doctor row pending delete confirmation
  const doDelete = async () => {
    if (!del) return;
    try {
      const res = await authedFetch(`/b2b/referral-doctors/${del.id}`, { method:'DELETE' });
      if (!res.ok) throw new Error();
      setDel(null); load(); showToast('success', `${del.name} removed`);
    } catch { setDel(null); showToast('error', 'Delete failed'); }
  };

  const save = async () => {
    if (!form.name.trim()) { showToast('error', 'Doctor name is required'); return; }
    setSaving(true);
    const wasCreate = !form.id;
    const payload = { name: form.name.trim(), phone: form.phone || null, commission_percent: Number(form.commission_percent) || 0,
                       qualification: form.qualification || null, registration_no: form.registration_no || null };
    const url    = form.id ? `/b2b/referral-doctors/${form.id}` : '/b2b/referral-doctors';
    const method = form.id ? 'PUT' : 'POST';
    try {
      const res = await authedFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      load(); showToast('success', form.id ? 'Doctor updated' : 'Doctor added');
      // On create, stay in the form (now in edit mode) so the signature can
      // be uploaded right away instead of having to reopen it. On edit, close.
      setForm(wasCreate
        ? { id:d.id, name:d.name, phone:d.phone, commission_percent:d.commission_percent,
            qualification:d.qualification||'', registration_no:d.registration_no||'', signature_url:d.signature_url||null }
        : null);
    } catch { showToast('error', 'Save failed'); }
    setSaving(false);
  };

  const uploadSignature = async (file) => {
    if (!file || !form?.id) return;
    setUploadingSig(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authedFetch(`/b2b/referral-doctors/${form.id}/signature`, { method:'POST', body: fd });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'Upload failed'); }
      const d = await res.json();
      setForm(f => ({ ...f, signature_url: d.signature_url }));
      load();
      showToast('success', 'Signature uploaded');
    } catch (e) { showToast('error', e.message || 'Upload failed'); }
    setUploadingSig(false);
  };

  const resetSignature = async () => {
    if (!form?.id) return;
    if (!window.confirm('Remove this signature image?')) return;
    setUploadingSig(true);
    try {
      const res = await authedFetch(`/b2b/referral-doctors/${form.id}/signature`, { method:'DELETE' });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setForm(f => ({ ...f, signature_url: d.signature_url }));
      load();
      showToast('success', 'Signature removed');
    } catch { showToast('error', 'Remove failed'); }
    setUploadingSig(false);
  };

  const payNow = async () => {
    if (!selected) return;
    setPaying(true);
    const payload = {};
    if (dateFrom) payload.date_from = dateFrom;
    if (dateTo) payload.date_to = dateTo;
    try {
      const res = await authedFetch(`/commission/doctors/${selected.id}/pay`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.detail || 'Nothing to pay in this range');
      showToast('success', `Paid ${inr(j.paid)} to ${selected.name} (${j.entries_settled} entr${j.entries_settled===1?'y':'ies'})`);
      fetchLedger(selected.id, dateFrom, dateTo); load();
    } catch (e) { showToast('error', String(e.message || 'Payment failed')); }
    setPaying(false);
  };

  const Toast = toast && (
    <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}` }}>
      <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='success'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)' }}>{toast.kind==='success'?'✓':'✕'}</div>
      <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
    </div>
  );

  // ─────────────────────────────────────────── ledger view (one doctor)
  if (selected) {
    const L = ledger;
    const summary = (L && L !== 'loading') ? L.summary : { earned:0, paid:0, outstanding:0, count:0 };
    return (
      <div>
        {Toast}
        <button onClick={closeLedger} style={{ background:'transparent', border:'none', color:'#8892a4', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', marginBottom:'1rem', padding:0, fontFamily:'Manrope,sans-serif' }}>← All Doctors</button>
        <div style={{ marginBottom:'1.5rem' }}>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Doctor Commission</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>{selected.name}</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{selected.phone || 'No phone on file'} · {selected.commission_percent}% commission{selected.has_login && <span style={{ marginLeft:'0.5rem', fontSize:'0.62rem', background:'rgba(37,99,235,0.1)', color:'#2563eb', padding:'0.12rem 0.5rem', borderRadius:'20px', fontWeight:700 }}>🩺 Has login</span>}</p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1rem', marginBottom:'1.2rem' }}>
          <div style={S.card}>
            <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Earned</div>
            <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#0f1218', marginTop:'0.3rem' }}>{inr(summary.earned)}</div>
          </div>
          <div style={S.card}>
            <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Paid</div>
            <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#16a34a', marginTop:'0.3rem' }}>{inr(summary.paid)}</div>
          </div>
          <div style={{ ...S.card, borderTop: summary.outstanding>0 ? '3px solid #f97316' : '3px solid transparent' }}>
            <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Outstanding</div>
            <div style={{ fontSize:'1.6rem', fontWeight:800, color: summary.outstanding>0?'#f97316':'#0f1218', marginTop:'0.3rem' }}>{inr(summary.outstanding)}</div>
          </div>
        </div>

        <div style={{ ...S.card, marginBottom:'1.2rem', display:'flex', gap:'0.7rem', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div><label style={lbl}>From</label><input type="date" style={inp} value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></div>
          <div><label style={lbl}>To</label><input type="date" style={inp} value={dateTo} onChange={e=>setDateTo(e.target.value)} /></div>
          <button onClick={applyDates} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply</button>
          <button onClick={clearDates} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
          <div style={{ flex:1 }} />
          <button onClick={payNow} disabled={paying || summary.outstanding<=0}
            style={{ background: (paying||summary.outstanding<=0) ? '#e8ecf4' : 'linear-gradient(135deg,#16a34a,#22c55e)', color: (paying||summary.outstanding<=0) ? '#94a3b8' : '#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.4rem', fontWeight:700, cursor: (paying||summary.outstanding<=0)?'not-allowed':'pointer', fontFamily:'Manrope,sans-serif' }}>
            {paying ? 'Paying…' : `💸 Pay ${inr(summary.outstanding)}${(dateFrom||dateTo) ? ' (this range)' : ''}`}
          </button>
        </div>

        <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
          <div style={{ fontWeight:800, color:'#0f1218', padding:'1.1rem 1.3rem 0.8rem', fontFamily:'Manrope,sans-serif' }}>Ledger · per test earned</div>
          {L === 'loading' && <div style={{ padding:'2.5rem', textAlign:'center', color:'#8892a4' }}>Loading…</div>}
          {L && L !== 'loading' && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
                  {['Date','Bill No','Barcode','Test','Amount','%','Commission','Paid?'].map(h => (
                    <th key={h} style={{ textAlign: ['Amount','%','Commission'].includes(h)?'right':'left', padding:'0.8rem 1.1rem', fontSize:'0.63rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {L.entries.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No commission entries in this range.</td></tr>
                )}
                {L.entries.map(e => (
                  <tr key={e.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                    <td style={{ padding:'0.8rem 1.1rem', color:'#8892a4', fontSize:'0.8rem' }}>{fmt(e.validated_at || e.created_at)}</td>
                    <td style={{ padding:'0.8rem 1.1rem', color:'#475569', fontSize:'0.8rem', fontFamily:'monospace' }}>{e.bill_no || '—'}</td>
                    <td style={{ padding:'0.8rem 1.1rem', color:'#f97316', fontSize:'0.8rem', fontFamily:'monospace', fontWeight:700 }}>{e.barcode || '—'}</td>
                    <td style={{ padding:'0.8rem 1.1rem', color:'#0f1218', fontSize:'0.82rem', fontWeight:600 }}>
                      {e.test_name}{e.package_name && <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', background:'rgba(249,115,22,0.12)', color:'#c2410c', padding:'0.1rem 0.45rem', borderRadius:'20px', fontWeight:700 }}>{e.package_name}</span>}
                    </td>
                    <td style={{ padding:'0.8rem 1.1rem', textAlign:'right', color:'#475569', fontSize:'0.8rem' }}>{inr(e.base_amount)}</td>
                    <td style={{ padding:'0.8rem 1.1rem', textAlign:'right', color:'#8892a4', fontSize:'0.8rem' }}>{e.commission_percent}%</td>
                    <td style={{ padding:'0.8rem 1.1rem', textAlign:'right', color:'#0f1218', fontWeight:700, fontSize:'0.85rem' }}>{inr(e.commission_amount)}</td>
                    <td style={{ padding:'0.8rem 1.1rem' }}>
                      {e.is_paid
                        ? <span style={{ fontSize:'0.65rem', background:'rgba(22,163,74,0.12)', color:'#16a34a', padding:'0.2rem 0.6rem', borderRadius:'20px', fontWeight:700 }}>✓ Paid</span>
                        : <span style={{ fontSize:'0.65rem', background:'rgba(249,115,22,0.12)', color:'#c2410c', padding:'0.2rem 0.6rem', borderRadius:'20px', fontWeight:700 }}>Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────── roster (all doctors)
  return (
    <div>
      {Toast}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Doctor Commission</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Referral Doctors</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{doctors.length} registered · commission is earned when the doctor validates a report</p>
        </div>
        <button onClick={openNew} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>+ Add Doctor</button>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Doctor','Phone','Commission %','Earned','Paid','Outstanding','Actions'].map(h => (
                <th key={h} style={{ textAlign: ['Earned','Paid','Outstanding','Commission %'].includes(h)?'right':'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>Loading…</td></tr>}
            {!loading && doctors.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>
                <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>🩺</div>
                No referral doctors registered yet. Add one to start tracking commission.
              </td></tr>
            )}
            {doctors.map(d => (
              <tr key={d.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>
                  {d.name} <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', background:'rgba(22,163,74,0.1)', color:'#16a34a', padding:'0.12rem 0.5rem', borderRadius:'20px', fontWeight:700 }}>✓ Registered</span>
                  {d.has_login && <span title="Has a Pathologist login — can validate reports" style={{ marginLeft:'0.4rem', fontSize:'0.6rem', background:'rgba(37,99,235,0.1)', color:'#2563eb', padding:'0.12rem 0.5rem', borderRadius:'20px', fontWeight:700 }}>🩺 Login</span>}
                </td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.85rem' }}>{d.phone || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', textAlign:'right', color:'#0f1218', fontWeight:600, fontSize:'0.85rem' }}>{d.commission_percent}%</td>
                <td style={{ padding:'0.9rem 1.3rem', textAlign:'right', color:'#475569', fontSize:'0.85rem' }}>{inr(d.earned)}</td>
                <td style={{ padding:'0.9rem 1.3rem', textAlign:'right', color:'#16a34a', fontSize:'0.85rem' }}>{inr(d.paid)}</td>
                <td style={{ padding:'0.9rem 1.3rem', textAlign:'right', fontWeight:700, fontSize:'0.85rem', color: d.outstanding>0?'#f97316':'#0f1218' }}>{inr(d.outstanding)}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="View ledger" onClick={()=>openLedger(d)} style={{ ...iconBtn('#f97316'), width:'auto', padding:'0 0.7rem', fontSize:'0.72rem', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>Ledger →</button>
                    <button title="Edit" onClick={()=>openEdit(d)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setDel(d)} style={iconBtn('#dc2626')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div onClick={()=>setForm(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ ...S.card, width:'440px', maxWidth:'96vw', maxHeight:'92vh', overflowY:'auto' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', fontSize:'1.1rem', marginBottom:'1rem' }}>{form.id ? 'Edit Doctor' : 'Add Referral Doctor'}</div>
            <div style={{ marginBottom:'0.8rem' }}>
              <label style={lbl}>Full Name</label>
              <input style={inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Dr. A. Sharma" />
            </div>
            <div style={{ marginBottom:'0.8rem' }}>
              <label style={lbl}>Phone (optional)</label>
              <input style={inp} value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="10-digit mobile" />
            </div>
            <div style={{ marginBottom:'0.8rem' }}>
              <label style={lbl}>Commission %</label>
              <input style={inp} type="number" step="0.5" value={form.commission_percent} onChange={e=>setForm({...form,commission_percent:e.target.value})} placeholder="10" />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>Applied to the billed test price when this doctor validates a report.</div>
            </div>

            {/* ── Signature block — printed on any report this doctor validates ── */}
            <div style={{ borderTop:'1px solid #e8ecf4', margin:'1rem 0 0.9rem', paddingTop:'0.9rem' }}>
              <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#0f1218', marginBottom:'0.7rem', fontFamily:'Manrope,sans-serif' }}>Signature block (shown when this doctor validates a report)</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem', marginBottom:'0.8rem' }}>
                <div><label style={lbl}>Qualification</label>
                  <input style={inp} value={form.qualification||''} onChange={e=>setForm({...form,qualification:e.target.value})} placeholder="MD (Pathology)" /></div>
                <div><label style={lbl}>Registration No.</label>
                  <input style={inp} value={form.registration_no||''} onChange={e=>setForm({...form,registration_no:e.target.value})} placeholder="63582" /></div>
              </div>

              {form.id ? (
                <SignatureUploadBox
                  previewUrl={form.signature_url}
                  uploading={uploadingSig}
                  inputRef={sigInputRef}
                  onPick={uploadSignature}
                  onReset={form.signature_url ? resetSignature : null}
                />
              ) : (
                <div style={{ fontSize:'0.72rem', color:'#8892a4', background:'#fafbfc', border:'1px dashed #e8ecf4', borderRadius:'9px', padding:'0.7rem 0.9rem' }}>
                  Save this doctor first — you'll be able to upload their signature image right after.
                </div>
              )}
            </div>

            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setForm(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>{form.id ? 'Close' : 'Cancel'}</button>
              <button onClick={save} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':(form.id?'Save changes':'Add Doctor')}</button>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div onClick={()=>setDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.1rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this doctor?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem' }}>
              <strong style={{ color:'#0f1218' }}>{del.name}</strong> will be removed from the roster. Their existing commission ledger entries are kept for history.
              {del.has_login && <div style={{ marginTop:'0.6rem', color:'#c2410c' }}>This doctor has a Pathologist login — they'll be re-added automatically (at 0%) next time the list loads, since they can still validate reports.</div>}
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600 }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SignatureUploadBox({ previewUrl, uploading, inputRef, onPick, onReset }) {
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
        style={{
          border: `1.5px dashed ${drag ? '#f97316' : '#e8ecf4'}`, borderRadius:'11px', padding:'0.9rem',
          display:'flex', alignItems:'center', gap:'0.9rem', cursor:'pointer',
          background: drag ? 'rgba(249,115,22,0.05)' : '#fafbfc', minHeight:'76px',
        }}>
        {previewUrl ? (
          <img src={previewUrl} alt="Signature" style={{ maxHeight:'56px', maxWidth:'140px', objectFit:'contain', background:'#fff', border:'1px solid #e8ecf4', borderRadius:'8px', padding:'0.3rem' }} />
        ) : (
          <div style={{ width:'56px', height:'56px', borderRadius:'8px', background:'#fff', border:'1px dashed #d8dde6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.2rem', color:'#c2c8d4', flexShrink:0 }}>✍️</div>
        )}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
            {uploading ? 'Uploading...' : previewUrl ? 'Click or drop to replace' : 'Click or drop a signature image'}
          </div>
          <div style={{ fontSize:'0.68rem', color:'#8892a4', marginTop:'0.15rem' }}>PNG, JPG or WEBP, up to 3 MB.</div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      {onReset && (
        <button onClick={onReset} disabled={uploading}
          style={{ marginTop:'0.5rem', background:'transparent', color:'#dc2626', border:'1px solid rgba(220,38,38,0.25)', borderRadius:'8px', padding:'0.35rem 0.8rem', fontSize:'0.72rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
          Remove signature
        </button>
      )}
    </div>
  );
}
