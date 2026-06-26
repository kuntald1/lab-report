import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const HISTORY_CHECKS = [
  { key:'diabetic',    label:'Diabetic' },
  { key:'fasting',     label:'Fasting sample' },
  { key:'medication',  label:'On medication' },
  { key:'pregnancy',   label:'Pregnant' },
  { key:'hypertension',label:'Hypertension' },
];

export default function HistoryNeeded() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail]   = useState(null);
  const [answer, setAnswer]   = useState('');
  const [checks, setChecks]   = useState({});
  const [busy, setBusy]       = useState(false);
  const [toast, setToast]     = useState(null);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  const load = () => {
    setLoading(true);
    authedFetch('/reports/queue/history-needed').then(r=>r.ok?r.json():[]).then(d=>{ setRows(d); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(() => { load(); const t = setInterval(load, 12000); return () => clearInterval(t); }, []);

  const open = (p) => {
    setDetail(p); setAnswer(''); 
    // prefill checklist from the doctor's request (what was asked)
    setChecks(p.request?.checklist || {});
  };

  const submit = async () => {
    if (!detail) return;
    if (!answer.trim() && !Object.values(checks).some(Boolean)) return showToast('error', 'Enter history details');
    setBusy(true);
    try {
      const res = await authedFetch(`/reports/${detail.id}/fill-history`, { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ answer: answer.trim() || null, answer_checklist: checks }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      showToast('success', 'History updated · doctor notified');
      setDetail(null); load();
    } catch (e) { showToast('error', String(e.message||'Update failed')); }
    setBusy(false);
  };

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}` }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='success'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)' }}>{toast.kind==='success'?'✓':'✕'}</div>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', color:'#b45309', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Clinical</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>History Needed</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{rows.length} patient(s) where a doctor requested more history</p>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Patient','Doctor asked for','Action'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.75rem 1.1rem', fontSize:'0.64rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>{loading?'Loading…':'No pending history requests.'}</td></tr>}
            {rows.map(p => {
              const asked = p.request?.checklist ? Object.keys(p.request.checklist).filter(k=>p.request.checklist[k]) : [];
              return (
                <tr key={p.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                  <td style={{ padding:'0.8rem 1.1rem', fontFamily:'monospace', fontWeight:700, color:'#b45309', fontSize:'0.8rem', cursor:'pointer', textDecoration:'underline' }} onClick={()=>open(p)}>{p.barcode}</td>
                  <td style={{ padding:'0.8rem 1.1rem', fontWeight:600, color:'#0f1218', fontSize:'0.85rem' }}>{p.patient_name}</td>
                  <td style={{ padding:'0.8rem 1.1rem', color:'#475569', fontSize:'0.8rem' }}>
                    {asked.length ? asked.join(', ') : '—'}
                    {p.request?.note && <div style={{ color:'#8892a4', fontSize:'0.74rem', marginTop:'0.2rem' }}>“{p.request.note}”</div>}
                  </td>
                  <td style={{ padding:'0.8rem 1.1rem' }}>
                    <button onClick={()=>open(p)} style={{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:'8px', padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer', fontSize:'0.8rem', fontFamily:'Manrope,sans-serif' }}>Fill History</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* fill modal */}
      {detail && (
        <div onClick={()=>setDetail(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'540px', maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
              <div>
                <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.2rem', color:'#0f1218' }}>{detail.patient_name}</div>
                <div style={{ color:'#8892a4', fontSize:'0.82rem', fontFamily:'monospace' }}>{detail.barcode}</div>
              </div>
              <button onClick={()=>setDetail(null)} style={{ border:'none', background:'transparent', fontSize:'1.4rem', color:'#c4cad6', cursor:'pointer' }}>×</button>
            </div>

            {detail.request?.note && (
              <div style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'10px', padding:'0.7rem 1rem', marginBottom:'1rem', fontSize:'0.82rem', color:'#92400e' }}>
                <strong>Doctor's request:</strong> {detail.request.note}
              </div>
            )}

            <label style={lbl}>Clinical history checklist</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'1rem' }}>
              {HISTORY_CHECKS.map(c => (
                <label key={c.key} style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.82rem', color:'#475569', cursor:'pointer' }}>
                  <input type="checkbox" checked={!!checks[c.key]} onChange={e=>setChecks({...checks,[c.key]:e.target.checked})} style={{ accentColor:'#16a34a', width:'15px', height:'15px' }} />
                  {c.label}
                </label>
              ))}
            </div>

            <label style={lbl}>History details</label>
            <textarea style={{ ...inp, minHeight:'90px', resize:'vertical' }} placeholder="e.g. Patient is diabetic for 5 years, on Metformin, last meal 8 hours ago" value={answer} onChange={e=>setAnswer(e.target.value)} />

            <div style={{ display:'flex', gap:'0.6rem', marginTop:'1.1rem' }}>
              <button onClick={submit} disabled={busy} style={{ flex:1, background:'#16a34a', color:'#fff', border:'none', borderRadius:'10px', padding:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
                {busy ? '…' : 'Submit + Notify Doctor'}
              </button>
              <button onClick={()=>setDetail(null)} disabled={busy} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.75rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
