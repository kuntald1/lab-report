import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';

const HISTORY_CHECKS = [
  { key:'diabetic',    label:'Diabetic?' },
  { key:'fasting',     label:'Fasting sample?' },
  { key:'medication',  label:'On medication?' },
  { key:'pregnancy',   label:'Pregnant?' },
  { key:'hypertension',label:'Hypertension?' },
];

export default function ReportValidate() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [toast, setToast]     = useState(null);
  const [mode, setMode]       = useState('view');   // view | need-history
  const [checks, setChecks]   = useState({});
  const [note, setNote]       = useState('');

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  const load = () => {
    setLoading(true);
    authedFetch('/reports/pending').then(r=>r.ok?r.json():[]).then(d=>{ setRows(d); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const open = (p) => {
    setMode('view'); setChecks({}); setNote('');
    authedFetch(`/reports/${p.id}`).then(r=>r.ok?r.json():null).then(setDetail).catch(()=>{});
  };

  // open the same clinical PDF the Results screen uses (/api/results/{result_id}/pdf)
  const openReportPdf = async (resultId) => {
    try {
      const res = await authedFetch(`/results/${resultId}/pdf`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(()=>URL.revokeObjectURL(url), 60000);
    } catch { showToast('error', 'Could not open report PDF'); }
  };

  const validate = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/reports/${detail.id}/validate`, { method:'POST' });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      showToast('success', `Report validated — ${detail.barcode} is now reported`);
      setDetail(null); load();
    } catch (e) { showToast('error', String(e.message||'Validate failed')); }
    setBusy(false);
  };

  const submitNeedHistory = async () => {
    if (!detail) return;
    const anyCheck = Object.values(checks).some(Boolean);
    if (!anyCheck && !note.trim()) return showToast('error', 'Tick at least one item or write a note');
    setBusy(true);
    try {
      const res = await authedFetch(`/reports/${detail.id}/need-history`, { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ checklist: checks, note: note.trim() || null }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const out = await res.json();
      showToast('success', out.org_notified ? 'History requested · organization notified on WhatsApp' : 'History requested');
      setDetail(null); load();
    } catch (e) { showToast('error', String(e.message||'Request failed')); }
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
        <div style={{ display:'inline-flex', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', color:'#6366f1', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Doctor</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Report Validate</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{rows.length} report(s) awaiting your validation</p>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Patient','Age/Gender','Sample','Status','Registered','Action'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.75rem 1.1rem', fontSize:'0.64rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>{loading?'Loading…':'No reports pending validation.'}</td></tr>}
            {rows.map(p => (
              <tr key={p.id} style={{ borderBottom:'1px solid #f4f6fa' }} onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.8rem 1.1rem', fontFamily:'monospace', fontWeight:700, color:'#6366f1', fontSize:'0.8rem' }}>{p.barcode}</td>
                <td style={{ padding:'0.8rem 1.1rem', fontWeight:600, color:'#0f1218', fontSize:'0.85rem' }}>{p.patient_name}</td>
                <td style={{ padding:'0.8rem 1.1rem', color:'#8892a4', fontSize:'0.82rem' }}>{p.age||'—'} / {p.gender||'—'}</td>
                <td style={{ padding:'0.8rem 1.1rem', color:'#475569', fontSize:'0.82rem' }}>{p.sample_type||'—'}</td>
                <td style={{ padding:'0.8rem 1.1rem' }}><span style={{ background:'rgba(245,158,11,0.15)', color:'#b45309', padding:'0.2rem 0.6rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:700 }}>{p.status}</span></td>
                <td style={{ padding:'0.8rem 1.1rem', color:'#8892a4', fontSize:'0.76rem' }}>{fmtDate(p.created_at)}</td>
                <td style={{ padding:'0.8rem 1.1rem' }}>
                  <button onClick={()=>open(p)} style={{ background:'#6366f1', color:'#fff', border:'none', borderRadius:'8px', padding:'0.45rem 1rem', fontWeight:700, cursor:'pointer', fontSize:'0.8rem', fontFamily:'Manrope,sans-serif' }}>Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* report detail modal */}
      {detail && (
        <div onClick={()=>setDetail(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'620px', maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
              <div>
                <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.2rem', color:'#0f1218' }}>{detail.patient_name}</div>
                <div style={{ color:'#8892a4', fontSize:'0.82rem', fontFamily:'monospace' }}>{detail.barcode} · {detail.age||'—'}/{detail.gender||'—'}</div>
              </div>
              <button onClick={()=>setDetail(null)} style={{ border:'none', background:'transparent', fontSize:'1.4rem', color:'#c4cad6', cursor:'pointer' }}>×</button>
            </div>

            {/* filled history, if any */}
            {detail.clinical_history && (
              <div style={{ background:'rgba(22,163,74,0.06)', border:'1px solid rgba(22,163,74,0.2)', borderRadius:'10px', padding:'0.8rem 1rem', marginBottom:'1rem', fontSize:'0.82rem' }}>
                <strong style={{ color:'#16a34a' }}>Clinical history:</strong> {detail.clinical_history}
              </div>
            )}

            {/* results */}
            <div style={{ fontWeight:800, color:'#0f1218', marginBottom:'0.6rem', fontFamily:'Manrope,sans-serif' }}>Results</div>
            <div style={{ border:'1px solid #f4f6fa', borderRadius:'10px', overflow:'hidden', marginBottom:'1.2rem' }}>
              {(!detail.results || detail.results.length === 0) && <div style={{ padding:'1rem', color:'#8892a4', fontSize:'0.85rem' }}>No results recorded.</div>}
              {detail.results?.map((r,i) => (
                <div key={i} style={{ padding:'0.8rem 1rem', borderBottom:'1px solid #f7f8fb' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
                    <div style={{ fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{r.test_name}</div>
                    <button onClick={()=>openReportPdf(r.id)} style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', border:'1px solid rgba(249,115,22,0.3)', borderRadius:'7px', padding:'0.35rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.74rem', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>📄 View Full Report (PDF)</button>
                  </div>
                  <ResultPreview data={r.parsed_data} />
                </div>
              ))}
            </div>

            {mode === 'view' ? (
              <div style={{ display:'flex', gap:'0.6rem' }}>
                <button onClick={validate} disabled={busy} style={{ flex:1, background:'#16a34a', color:'#fff', border:'none', borderRadius:'10px', padding:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.9rem' }}>
                  {busy ? '…' : '✓ Validate Report'}
                </button>
                <button onClick={()=>setMode('need-history')} disabled={busy} style={{ flex:1, background:'#fff', color:'#b45309', border:'1.5px solid #f59e0b', borderRadius:'10px', padding:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.9rem' }}>
                  Need More History
                </button>
              </div>
            ) : (
              <div style={{ border:'1px solid rgba(245,158,11,0.3)', borderRadius:'12px', padding:'1.1rem', background:'rgba(245,158,11,0.04)' }}>
                <div style={{ fontWeight:800, color:'#b45309', marginBottom:'0.7rem' }}>Request more history</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'0.8rem' }}>
                  {HISTORY_CHECKS.map(c => (
                    <label key={c.key} style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.82rem', color:'#475569', cursor:'pointer' }}>
                      <input type="checkbox" checked={!!checks[c.key]} onChange={e=>setChecks({...checks,[c.key]:e.target.checked})} style={{ accentColor:'#f59e0b', width:'15px', height:'15px' }} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <label style={lbl}>Note (optional)</label>
                <textarea style={{ ...inp, minHeight:'70px', resize:'vertical' }} placeholder="e.g. Confirm last meal time and any thyroid medication" value={note} onChange={e=>setNote(e.target.value)} />
                <div style={{ display:'flex', gap:'0.6rem', marginTop:'0.9rem' }}>
                  <button onClick={submitNeedHistory} disabled={busy} style={{ flex:1, background:'#f59e0b', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
                    {busy ? '…' : 'Send Request + Notify Org'}
                  </button>
                  <button onClick={()=>setMode('view')} disabled={busy} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.7rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Back</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Render parsed_data in a readable way (handles flat objects, {parameters:[...]}, and arrays)
function ResultPreview({ data }) {
  if (data == null) return <div style={{ fontSize:'0.78rem', color:'#8892a4' }}>No parsed values.</div>;
  if (typeof data !== 'object') return <div style={{ fontSize:'0.82rem', color:'#475569' }}>{String(data)}</div>;

  // common shape: { parameters: [ {name, value, unit, range, flag} ] }
  const rows = Array.isArray(data) ? data
    : Array.isArray(data.parameters) ? data.parameters
    : Object.entries(data).map(([k, v]) => ({ name: k, value: (typeof v === 'object' ? JSON.stringify(v) : v) }));

  const cell = { padding:'0.3rem 0.6rem', fontSize:'0.78rem', borderBottom:'1px solid #f4f6fa' };
  const flagColor = (f) => /high|↑/i.test(f||'') ? '#dc2626' : /low|↓/i.test(f||'') ? '#2563eb' : '#16a34a';

  return (
    <div style={{ border:'1px solid #f4f6fa', borderRadius:'8px', overflow:'hidden' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ background:'#fafbfc' }}>
            {['Parameter','Result','Unit','Range','Flag'].map(h => (
              <th key={h} style={{ ...cell, textAlign:'left', color:'#8892a4', fontWeight:700, fontSize:'0.66rem', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const name  = r.name ?? r.parameter ?? r.test ?? '';
            const value = r.value ?? r.result ?? '';
            const unit  = r.unit ?? r.units ?? '';
            const range = r.range ?? r.reference ?? r.ref ?? r.normal_value ?? '';
            const flag  = r.flag ?? r.status ?? '';
            return (
              <tr key={i}>
                <td style={{ ...cell, color:'#0f1218', fontWeight:600 }}>{name}</td>
                <td style={{ ...cell, color:'#0f1218', fontWeight:700 }}>{String(value)}</td>
                <td style={{ ...cell, color:'#8892a4' }}>{unit}</td>
                <td style={{ ...cell, color:'#8892a4' }}>{range}</td>
                <td style={{ ...cell, color:flagColor(flag), fontWeight:700 }}>{flag}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
