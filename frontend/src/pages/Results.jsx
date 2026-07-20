import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { authedFetch } from '../services/auth';

// FastAPI 422s return `detail` as an array of {loc,msg,type} objects, not a plain string —
// Error(arrayOfObjects) stringifies to "[object Object],[object Object]". Format it properly.
const apiErrorText = (detail) => {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => (d && d.msg) ? d.msg : JSON.stringify(d)).join('; ');
  if (typeof detail === 'object') return detail.msg || JSON.stringify(detail);
  return String(detail);
};

const lifeColor = { collected:'#0ea5e9', dispatched:'#6366f1', received:'#8b5cf6', tested:'#f59e0b', validated:'#16a34a', reported:'#0f766e', sample_rejected:'#dc2626' };

const S = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const flagColor  = f => f==='H'?'#dc2626':f==='L'?'#2563eb':'#16a34a';
const flagBg     = f => f==='H'?'#fef2f2':f==='L'?'#eff6ff':'#f0fdf4';
const flagBorder = f => f==='H'?'#fecaca':f==='L'?'#bfdbfe':'#bbf7d0';

// Lightweight inline SVG line chart for the GH-900 chromatogram —
// no chart library dependency needed.
function ChromatogramChart({ data }) {
  if (!data || data.length === 0) return null;

  // Plot the FULL curve on a 0–TIME_MAX time axis (calibrated to the machine's
  // display window) so the peak lands at the same position as on the analyser
  // screen. No baseline trimming — the leading/trailing baseline is shown.
  const TIME_MAX = 130;
  const W = 600, H = 200, PAD = 34;
  const n = data.length;
  const maxY = Math.max(...data, 0.01);
  const xAtTime = t => PAD + (t / TIME_MAX) * (W - 2*PAD);
  const xAtIdx  = i => xAtTime((i / (n - 1 || 1)) * TIME_MAX);
  const yAt     = v => H - PAD - (v / maxY) * (H - 2*PAD);
  const points = data.map((v, i) => `${xAtIdx(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

  // X ticks every 20 time units (matches the machine grid)
  const ticks = [];
  for (let t = 0; t <= TIME_MAX; t += 20) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto', background:'#fff' }}>
      {/* axes */}
      <line x1={PAD} y1={H-PAD} x2={W-PAD} y2={H-PAD} stroke="#d1d5db" strokeWidth="1"/>
      <line x1={PAD} y1={PAD} x2={PAD} y2={H-PAD} stroke="#d1d5db" strokeWidth="1"/>
      {/* x ticks + labels every 20 */}
      {ticks.map(t => (
        <g key={t}>
          <line x1={xAtTime(t)} y1={H-PAD} x2={xAtTime(t)} y2={H-PAD+4} stroke="#d1d5db" strokeWidth="1"/>
          <text x={xAtTime(t)} y={H-PAD+14} fontSize="8" fill="#8892a4" textAnchor="middle">{t}</text>
        </g>
      ))}
      {/* y-axis label */}
      <text x={PAD-8} y={PAD-6} fontSize="8" fill="#8892a4" textAnchor="start">10mOD</text>
      {/* curve */}
      <polyline points={points} fill="none" stroke="#dc2626" strokeWidth="1.5"/>
    </svg>
  );
}

export default function Results() {
  const [results, setResults] = useState([]);
  const [sel,     setSel]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState({ barcode:'', accession_number:'' });

  const load = () => {
    const qs = new URLSearchParams();
    if (q.barcode) qs.set('barcode', q.barcode);
    if (q.accession_number) qs.set('accession_number', q.accession_number);
    authedFetch('/results/?' + qs.toString()).then(r=>r.ok?r.json():[]).then(d=>setResults(Array.isArray(d)?d:[])).catch(()=>setResults([]));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setEditing(false); }, [sel?.id]);

  const downloadPDF = async (id) => {
    setLoading(true);
    try {
      const r = await authedFetch(`/results/${id}/pdf`);
      if (!r.ok) {
        const e = await r.json().catch(()=>({}));
        throw new Error(apiErrorText(e.detail) || 'PDF not available');
      }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url; a.download=`MediCloud_Report_${id}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) { alert(String(err.message || 'PDF failed')); }
    setLoading(false);
  };

  // every OTHER result (excluding the selected one) that shares the same barcode — for "combine" downloads
  const siblingResults = sel ? results.filter(r => r.id != null && r.barcode === sel.barcode) : [];

  const downloadCombinedPDF = async () => {
    if (siblingResults.length < 2) return;
    setLoading(true);
    try {
      const ids = siblingResults.map(r=>r.id).join(',');
      const r = await authedFetch(`/results/combined-pdf?ids=${ids}`);
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(apiErrorText(e.detail) || 'PDF not available'); }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `MediCloud_Combined_${sel.barcode}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) { alert(String(err.message || 'Combined PDF failed')); }
    setLoading(false);
  };

  // ---- inline edit of parameter values ----
  const [editing, setEditing]     = useState(false);
  const [editParams, setEditParams] = useState([]);
  const [saving, setSaving]       = useState(false);

  const startEdit = () => { setEditParams((sel.parsed_data?.parameters||[]).map(p=>({...p}))); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const changeParam = (i, field, val) => setEditParams(prev => prev.map((p,idx)=> idx===i ? {...p, [field]: val} : p));

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await authedFetch(`/results/${sel.id}`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: editParams }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(apiErrorText(e.detail) || 'Save failed'); }
      const updated = await res.json();
      setSel(prev => ({ ...prev, parsed_data: updated.parsed_data }));
      setResults(prev => prev.map(r => r.id === sel.id ? { ...r, parsed_data: updated.parsed_data } : r));
      setEditing(false);
    } catch (err) { alert(String(err.message || 'Save failed')); }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Lab Reports</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Results</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{results.length} results — click to view details</p>
      </div>

      <div style={{ display:'flex', gap:'0.6rem', alignItems:'flex-end', marginBottom:'1.2rem', flexWrap:'wrap' }}>
        <div><div style={{ fontSize:'0.68rem', fontWeight:700, color:'#8892a4', marginBottom:'0.25rem' }}>Barcode</div>
          <input value={q.barcode} onChange={e=>setQ({...q,barcode:e.target.value})} onKeyDown={e=>e.key==='Enter'&&load()}
            style={{ padding:'0.5rem 0.7rem', borderRadius:8, border:'1px solid #e8ecf4', fontSize:'0.84rem' }} /></div>
        <div><div style={{ fontSize:'0.68rem', fontWeight:700, color:'#8892a4', marginBottom:'0.25rem' }}>Accession No.</div>
          <input value={q.accession_number} onChange={e=>setQ({...q,accession_number:e.target.value})} onKeyDown={e=>e.key==='Enter'&&load()}
            style={{ padding:'0.5rem 0.7rem', borderRadius:8, border:'1px solid #e8ecf4', fontSize:'0.84rem' }} /></div>
        <button onClick={load} style={{ padding:'0.5rem 1.1rem', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:'0.82rem', color:'#fff', background:'linear-gradient(135deg,#f97316,#fbbf24)' }}>Search</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: sel ? '1fr 1.1fr' : '1fr', gap:'1.5rem', alignItems:'start' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
          {results.length === 0 && (
            <div style={{ ...S.card, padding:'3rem', textAlign:'center', color:'#8892a4' }}>
              <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>🧪</div>
              No results yet. Use the Simulator to generate test data.
            </div>
          )}
          {results.map((r,i) => (
            <div key={r.id != null ? `res-${r.id}` : `manual-${i}-${r.barcode}-${r.created_at}`} onClick={() => { if (!r.locked) setSel(r); }} style={{
              ...S.card, padding:'1rem 1.3rem', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', transition:'all 0.15s',
              background: sel===r ? '#fffbf7' : '#fff',
              border: sel===r ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid #e8ecf4',
              boxShadow: sel===r ? '0 4px 20px rgba(249,115,22,0.12)' : '0 2px 8px rgba(15,18,24,0.05)',
            }}
              onMouseEnter={e=>{ if(sel!==r){ e.currentTarget.style.background='#fafbfc'; e.currentTarget.style.borderColor='#d1d5db'; }}}
              onMouseLeave={e=>{ if(sel!==r){ e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#e8ecf4'; }}}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.8rem' }}>
                <div style={{ width:'40px', height:'40px', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.15)', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem' }}>🧪</div>
                <div>
                  <div style={{ fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{r.patient_name}</div>
                  <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.1rem' }}>
                    {r.test_name} · <span style={{ color:'#f97316', fontWeight:700 }}>{r.barcode}</span>
                    {r.accession_number && <> · <span style={{ color:'#c2410c', fontWeight:700, fontFamily:'monospace' }}>{r.accession_number}</span></>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                {r.lifecycle_status && (
                  <span style={{ fontSize:'0.66rem', background:(lifeColor[r.lifecycle_status]||'#94a3b8')+'22', color:lifeColor[r.lifecycle_status]||'#94a3b8', padding:'0.2rem 0.6rem', borderRadius:'20px', fontWeight:800, textTransform:'capitalize', marginRight:'0.35rem' }}>{r.lifecycle_status}</span>
                )}
                {r.lifecycle_status && !['reported'].includes(r.lifecycle_status) && (
                  <span style={{ fontSize:'0.66rem', background:'rgba(245,158,11,0.15)', color:'#b45309', padding:'0.2rem 0.6rem', borderRadius:'20px', fontWeight:800, marginRight:'0.35rem' }}>⏳ PENDING</span>
                )}
                <span style={{ fontSize:'0.68rem', background:'rgba(34,197,94,0.1)', color:'#16a34a', padding:'0.2rem 0.65rem', borderRadius:'20px', fontWeight:700, border:'1px solid rgba(34,197,94,0.2)' }}>{r.status}</span>
                {r.over_limit && <span title="This franchise is over its credit limit" style={{ marginLeft:'0.35rem', fontSize:'0.62rem', background:'rgba(220,38,38,0.12)', color:'#dc2626', padding:'0.2rem 0.5rem', borderRadius:'20px', fontWeight:800 }}>🔴 OVER LIMIT</span>}
                {r.locked && <span style={{ marginLeft:'0.35rem', fontSize:'0.62rem', background:'rgba(220,38,38,0.12)', color:'#dc2626', padding:'0.2rem 0.5rem', borderRadius:'20px', fontWeight:800 }}>🔒</span>}
                <div style={{ fontSize:'0.68rem', color:'#8892a4', marginTop:'0.3rem' }}>{new Date(r.created_at).toLocaleString('en-IN')}</div>
              </div>
            </div>
          ))}
        </div>

        {sel && (
          <div style={{ ...S.card, padding:'1.8rem', position:'sticky', top:'5rem', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.2rem' }}>
              <div>
                <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1rem', color:'#0f1218' }}>Lab Report</div>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.15rem' }}>Result #{sel.id}</div>
              </div>
              <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', justifyContent:'flex-end' }}>
                {!sel.locked && siblingResults.length > 1 && (
                <button onClick={downloadCombinedPDF} disabled={loading} title={`Combine all ${siblingResults.length} results under ${sel.barcode} into one PDF`} style={{ background:'#eef2ff', color:'#4338ca', border:'1px solid #c7d2fe', borderRadius:'8px', padding:'0.5rem 0.9rem', cursor:'pointer', fontSize:'0.78rem', fontWeight:700, fontFamily:'Manrope,sans-serif', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  📎 Combine ({siblingResults.length}) & Download
                </button>
                )}
                {!sel.locked && !editing && (sel.parsed_data?.parameters?.length > 0) && (
                <button onClick={startEdit} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', color:'#475569', borderRadius:'8px', padding:'0.5rem 0.9rem', cursor:'pointer', fontSize:'0.78rem', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>✎ Edit</button>
                )}
                {!sel.locked && (
                <button onClick={() => downloadPDF(sel.id)} disabled={loading} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'8px', padding:'0.5rem 1rem', cursor:'pointer', fontSize:'0.78rem', fontWeight:700, fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 12px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  {loading?'⏳':'📄'} {loading?'Generating...':'Download PDF'}
                </button>
                )}
                <button onClick={()=>{ setSel(null); setEditing(false); }} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'8px', padding:'0.5rem 0.7rem', cursor:'pointer' }}>✕</button>
              </div>
            </div>

            <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'1rem', marginBottom:'1.2rem' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem' }}>
                {[
                  { label:'Patient', value:sel.patient_name },
                  { label:'Barcode', value:sel.barcode },
                  { label:'Accession No.', value:sel.accession_number || '—' },
                  { label:'Device',  value:sel.device_name||'Manual' },
                  { label:'Protocol',value:sel.parsed_data?.protocol||'ASTM' },
                ].map(x => (
                  <div key={x.label}>
                    <div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>{x.label}</div>
                    <div style={{ fontSize:'0.85rem', color:'#0f1218', fontWeight:600, marginTop:'0.15rem' }}>{x.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {sel.locked && (
              <div style={{ background:'rgba(220,38,38,0.06)', border:'1px solid rgba(220,38,38,0.25)', borderRadius:'10px', padding:'1.4rem', textAlign:'center', color:'#b91c1c' }}>
                <div style={{ fontSize:'1.8rem', marginBottom:'0.4rem' }}>🔒</div>
                <div style={{ fontWeight:800, fontSize:'0.95rem', marginBottom:'0.3rem' }}>Your credit limit is exceeded</div>
                <div style={{ fontSize:'0.8rem', fontWeight:500, lineHeight:1.5 }}>Settle the outstanding from <strong>Manage Credit</strong> to view this report's values and download the PDF.</div>
              </div>
            )}

            {!sel.locked && (
            <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.8rem' }}>
              Parameters ({sel.parsed_data?.parameters?.length||0})
            </div>
            )}
            {editing ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {editParams.map((p,i) => (
                  <div key={i} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.8rem', display:'grid', gridTemplateColumns:'1.3fr 0.8fr 0.6fr 0.7fr', gap:'0.4rem', alignItems:'center' }}>
                    <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{p.name}</div>
                    <input value={p.value} onChange={e=>changeParam(i,'value',e.target.value)}
                      style={{ padding:'0.4rem 0.5rem', borderRadius:6, border:'1.5px solid #f97316', fontSize:'0.82rem', fontWeight:700 }} />
                    <select value={p.flag||'N'} onChange={e=>changeParam(i,'flag',e.target.value)}
                      style={{ padding:'0.4rem 0.3rem', borderRadius:6, border:'1px solid #e8ecf4', fontSize:'0.76rem' }}>
                      <option value="N">Normal</option>
                      <option value="H">High</option>
                      <option value="L">Low</option>
                    </select>
                    <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>{p.unit} · {p.ref_min}–{p.ref_max}</div>
                  </div>
                ))}
                <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.4rem' }}>
                  <button onClick={saveEdit} disabled={saving} style={{ flex:1, background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':'✓ Save Changes'}</button>
                  <button onClick={cancelEdit} disabled={saving} style={{ background:'transparent', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'9px', padding:'0.6rem 1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
                </div>
              </div>
            ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
              {(sel.parsed_data?.parameters||[]).map((p,i) => (
                <div key={i} style={{ background:flagBg(p.flag), border:`1px solid ${flagBorder(p.flag)}`, borderRadius:'9px', padding:'0.7rem 0.9rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:'0.85rem', fontWeight:700, color:'#0f1218' }}>{p.name}</div>
                    <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>Ref: {p.ref_min}–{p.ref_max} {p.unit}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:'1.05rem', fontWeight:800, color:flagColor(p.flag), fontFamily:'Manrope,sans-serif' }}>{p.value}</div>
                      <div style={{ fontSize:'0.65rem', color:'#8892a4' }}>{p.unit}</div>
                    </div>
                    <span style={{ fontSize:'0.62rem', background:flagColor(p.flag), color:'#fff', padding:'0.2rem 0.5rem', borderRadius:'4px', fontWeight:700 }}>
                      {p.flag==='H'?'HIGH':p.flag==='L'?'LOW':'OK'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            )}

            {sel.parsed_data?.gh900_info && (
              <>
                <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', margin:'1.2rem 0 0.6rem' }}>
                  Result Details
                </div>
                <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'1rem', marginBottom:'1rem' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem' }}>
                    {[
                      { label:'NGSP',       value:`${sel.parsed_data.gh900_info.ngsp} %` },
                      { label:'IFCC',       value:`${sel.parsed_data.gh900_info.ifcc} mmol/mol` },
                      { label:'Area (Total)', value:sel.parsed_data.gh900_info.area_total },
                    ].map(x => (
                      <div key={x.label}>
                        <div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>{x.label}</div>
                        <div style={{ fontSize:'0.85rem', color:'#0f1218', fontWeight:600, marginTop:'0.15rem' }}>{x.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {sel.parsed_data?.chromatogram && (
              <>
                <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>
                  Chromatogram
                </div>
                <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.8rem' }}>
                  <ChromatogramChart data={sel.parsed_data.chromatogram} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
