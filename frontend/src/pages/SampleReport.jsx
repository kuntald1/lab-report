import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.55rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.64rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.3rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const money = (n) => '₹' + (Number(n||0)).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';
const STATUSES = ['', 'dispatched','received','tested','validated','reported'];

export default function SampleReport() {
  const [f, setF] = useState({ franchise_id:'', branch_id:'', date_from:'', date_to:'', patient_id:'', barcode:'', status:'' });
  const [data, setData] = useState({ rows:[], totals:{} });
  const [loading, setLoading] = useState(false);
  const [franchises, setFranchises] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [tab, setTab] = useState({});   // per-row active tab: tests | payments | history

  const openReportPdf = async (resultId) => {
    if (!resultId) return;
    try {
      const res = await authedFetch(`/results/${resultId}/pdf`);
      if (!res.ok) throw new Error();
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      window.open(url, '_blank'); setTimeout(()=>URL.revokeObjectURL(url), 60000);
    } catch { alert('Report PDF not available for this test'); }
  };

  useEffect(() => {
    authedFetch('/franchises').then(r=>r.ok?r.json():[]).then(d=>setFranchises(Array.isArray(d)?d:(d.items||[]))).catch(()=>{});
    load();
  }, []); // eslint-disable-line

  const load = () => {
    setLoading(true);
    const qs = Object.entries(f).filter(([,v])=>v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    authedFetch(`/reports2/sample-details${qs?`?${qs}`:''}`).then(r=>r.ok?r.json():{rows:[],totals:{}}).then(d=>{ setData(d); setLoading(false); }).catch(()=>setLoading(false));
  };

  const set = (k,v) => setF(prev=>({ ...prev, [k]:v }));
  const toggle = (id) => { setExpanded(e=>({ ...e, [id]:!e[id] })); setTab(t=>({ ...t, [id]: t[id]||'tests' })); };

  const exportCsv = () => {
    const head = ['Patient ID','Barcode','Patient','Status','Franchise','Branch','Ref Doctor','Tests','Billed','Collected','Balance','Payment Modes'];
    const lines = [head.join(',')];
    data.rows.forEach(r => {
      const tests = r.tests.map(t=>t.test_name).join(' | ');
      lines.push([r.patient_id, r.barcode, `"${r.patient_name}"`, r.status, `"${r.franchise}"`, `"${r.branch}"`, `"${r.referring_doctor||''}"`, `"${tests}"`, r.billed, r.collected, r.balance, `"${r.payment_modes.join(' ')}"`].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'sample-details.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const statusColor = (s) => ({ dispatched:'#7c3aed', received:'#0891b2', tested:'#b45309', validated:'#0f766e', reported:'#16a34a' }[s] || '#8892a4');

  return (
    <div>
      <div style={{ marginBottom:'1.3rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', color:'#6366f1', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.5rem' }}>Reports</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Sample / Test Details</h1>
      </div>

      {/* filters */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'0.8rem', alignItems:'end' }}>
          <div><label style={lbl}>Franchise</label>
            <select style={inp} value={f.franchise_id} onChange={e=>set('franchise_id',e.target.value)}>
              <option value="">All</option>
              {franchises.map(fr => <option key={fr.id} value={fr.id}>{fr.name}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Branch ID</label><input style={inp} value={f.branch_id} onChange={e=>set('branch_id',e.target.value)} placeholder="e.g. 1" /></div>
          <div><label style={lbl}>From</label><input style={inp} type="date" value={f.date_from} onChange={e=>set('date_from',e.target.value)} /></div>
          <div><label style={lbl}>To</label><input style={inp} type="date" value={f.date_to} onChange={e=>set('date_to',e.target.value)} /></div>
          <div><label style={lbl}>Patient ID</label><input style={inp} value={f.patient_id} onChange={e=>set('patient_id',e.target.value)} /></div>
          <div><label style={lbl}>Barcode</label><input style={inp} value={f.barcode} onChange={e=>set('barcode',e.target.value)} /></div>
          <div><label style={lbl}>Status</label>
            <select style={inp} value={f.status} onChange={e=>set('status',e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{s ? s[0].toUpperCase()+s.slice(1) : 'All'}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button onClick={load} style={{ flex:1, background:'linear-gradient(135deg,#6366f1,#818cf8)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply</button>
            <button onClick={()=>{ setF({ franchise_id:'', branch_id:'', date_from:'', date_to:'', patient_id:'', barcode:'', status:'' }); setTimeout(load,0); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.9rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
          </div>
        </div>
      </div>

      {/* totals */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'0.8rem', marginBottom:'1.2rem' }}>
        {[['Patients', data.totals.patients||0, '#6366f1'], ['Billed', money(data.totals.billed), '#0f1218'], ['Collected', money(data.totals.collected), '#16a34a'], ['Balance', money(data.totals.balance), '#dc2626']].map(([k,v,c]) => (
          <div key={k} style={{ ...S.card, padding:'1rem 1.2rem' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:c, fontFamily:'Manrope,sans-serif' }}>{v}</div>
            <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600, marginTop:'0.2rem' }}>{k}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'0.6rem' }}>
        <button onClick={exportCsv} style={{ background:'#fff', color:'#16a34a', border:'1.5px solid #16a34a', borderRadius:'9px', padding:'0.5rem 1.1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem' }}>⬇ Export CSV</button>
      </div>

      {/* table */}
      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['','Barcode','Patient','Status','Franchise / Branch','Tests','Billed','Collected','Balance'].map((h,i) => (
                <th key={i} style={{ textAlign: i>5?'right':'left', padding:'0.7rem 1rem', fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>{loading?'Loading…':'No samples match these filters.'}</td></tr>}
            {data.rows.map(r => (
              <>
                <tr key={r.patient_id} style={{ borderBottom:'1px solid #f4f6fa', cursor:'pointer' }} onClick={()=>toggle(r.patient_id)}>
                  <td style={{ padding:'0.7rem 1rem', color:'#8892a4' }}>{expanded[r.patient_id]?'▾':'▸'}</td>
                  <td style={{ padding:'0.7rem 1rem', fontFamily:'monospace', fontWeight:700, color:'#6366f1', fontSize:'0.8rem' }}>{r.barcode}</td>
                  <td style={{ padding:'0.7rem 1rem', fontWeight:600, color:'#0f1218', fontSize:'0.84rem' }}>{r.patient_name}<div style={{ color:'#8892a4', fontSize:'0.72rem' }}>#{r.patient_id} · {r.age||'—'}/{r.gender||'—'}</div></td>
                  <td style={{ padding:'0.7rem 1rem' }}><span style={{ background:`${statusColor(r.status)}22`, color:statusColor(r.status), padding:'0.2rem 0.6rem', borderRadius:'20px', fontSize:'0.68rem', fontWeight:700 }}>{r.status||'—'}</span></td>
                  <td style={{ padding:'0.7rem 1rem', fontSize:'0.8rem', color:'#475569' }}>{r.franchise}<div style={{ color:'#8892a4', fontSize:'0.72rem' }}>{r.branch}</div></td>
                  <td style={{ padding:'0.7rem 1rem', fontSize:'0.8rem', color:'#475569' }}>{r.tests.length} test(s)</td>
                  <td style={{ padding:'0.7rem 1rem', textAlign:'right', fontWeight:700, color:'#0f1218', fontSize:'0.82rem' }}>{money(r.billed)}</td>
                  <td style={{ padding:'0.7rem 1rem', textAlign:'right', fontWeight:700, color:'#16a34a', fontSize:'0.82rem' }}>{money(r.collected)}</td>
                  <td style={{ padding:'0.7rem 1rem', textAlign:'right', fontWeight:700, color: r.balance>0?'#dc2626':'#8892a4', fontSize:'0.82rem' }}>{money(r.balance)}</td>
                </tr>
                {expanded[r.patient_id] && (
                  <tr key={r.patient_id+'-d'}>
                    <td colSpan={9} style={{ padding:'0', background:'#fbfcfe' }}>
                      <div style={{ padding:'1rem 1.5rem 1.4rem' }}>
                        {/* tabs */}
                        <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.9rem', borderBottom:'1.5px solid #eef1f6' }}>
                          {[['tests',`Tests (${r.tests.length})`],['payments',`Payments (${r.payment_history.length})`],['history',`History (${r.clinical_history.length})`]].map(([key,label])=>{
                            const active = (tab[r.patient_id]||'tests')===key;
                            return (
                              <button key={key} onClick={()=>setTab(t=>({ ...t, [r.patient_id]:key }))}
                                style={{ background:'transparent', border:'none', borderBottom: active?'2px solid #6366f1':'2px solid transparent', color: active?'#6366f1':'#8892a4', fontWeight:700, fontSize:'0.78rem', padding:'0.4rem 0.8rem', cursor:'pointer', marginBottom:'-1.5px', fontFamily:'Manrope,sans-serif' }}>{label}</button>
                            );
                          })}
                        </div>

                        {/* TESTS tab */}
                        {(tab[r.patient_id]||'tests')==='tests' && (
                          <div>
                            {r.tests.length===0 && <div style={{ color:'#8892a4', fontSize:'0.8rem', padding:'0.5rem 0' }}>No tests billed.</div>}
                            {r.tests.map((t,i)=>(
                              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.7rem', borderBottom:'1px solid #f1f3f7', fontSize:'0.82rem', gap:'1rem' }}>
                                <span style={{ color:'#0f1218', fontWeight:600, flex:1 }}>{t.test_name}<span style={{ color:'#8892a4', fontWeight:400 }}> · {t.doctor||'No doctor'}</span></span>
                                <span style={{ color:'#475569', fontWeight:700, width:'90px', textAlign:'right' }}>{money(t.price)}</span>
                                {t.result_id
                                  ? <button onClick={()=>openReportPdf(t.result_id)} style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', border:'1px solid rgba(249,115,22,0.3)', borderRadius:'7px', padding:'0.3rem 0.7rem', fontWeight:700, cursor:'pointer', fontSize:'0.72rem', whiteSpace:'nowrap', fontFamily:'Manrope,sans-serif' }}>📄 Report PDF</button>
                                  : <span style={{ color:'#c4cad6', fontSize:'0.7rem', width:'92px', textAlign:'center' }}>No report</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* PAYMENTS tab */}
                        {tab[r.patient_id]==='payments' && (
                          <div>
                            {r.payment_history.length===0 && <div style={{ color:'#8892a4', fontSize:'0.8rem', padding:'0.5rem 0' }}>No payment attempts.</div>}
                            {r.payment_history.map((ph,i)=>{
                              const col = ph.status==='success'?'#16a34a':(['failed','timeout','cancelled'].includes(ph.status))?'#dc2626':'#b45309';
                              return (
                                <div key={i} style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'0.45rem 0.7rem', borderBottom:'1px solid #f1f3f7', fontSize:'0.78rem', gap:'1rem' }}>
                                  <div style={{ flex:1 }}>
                                    <span style={{ display:'inline-block', minWidth:'62px', fontWeight:800, color:col, textTransform:'uppercase', fontSize:'0.62rem', letterSpacing:'0.03em' }}>{ph.status}</span>
                                    <span style={{ color:'#0f1218', fontWeight:600 }}>{ph.method||ph.kind}</span>
                                    <span style={{ color:'#475569' }}> · {money(ph.amount)}</span>
                                    {ph.error && <div style={{ color:'#dc2626', fontSize:'0.7rem', marginTop:'0.15rem' }}>{ph.error.length>90?ph.error.slice(0,90)+'…':ph.error}</div>}
                                  </div>
                                  <span style={{ color:'#8892a4', fontSize:'0.72rem', whiteSpace:'nowrap' }}>{fmt(ph.at)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* HISTORY tab */}
                        {tab[r.patient_id]==='history' && (
                          <div>
                            {r.clinical_history.length===0 && <div style={{ color:'#8892a4', fontSize:'0.8rem', padding:'0.5rem 0' }}>No history requests.</div>}
                            {r.clinical_history.map((h,i)=>(
                              <div key={i} style={{ padding:'0.5rem 0.8rem', marginBottom:'0.4rem', borderRadius:'8px', fontSize:'0.8rem', background: h.status==='answered'?'rgba(22,163,74,0.06)':'rgba(245,158,11,0.06)', border:`1px solid ${h.status==='answered'?'rgba(22,163,74,0.18)':'rgba(245,158,11,0.18)'}` }}>
                                <div style={{ display:'flex', justifyContent:'space-between' }}>
                                  <span style={{ fontWeight:700, color: h.status==='answered'?'#16a34a':'#b45309' }}>{(h.asked_for||[]).join(', ')||'History request'}</span>
                                  <span style={{ color:'#8892a4', fontSize:'0.7rem' }}>{fmt(h.created_at)}</span>
                                </div>
                                {h.note && <div style={{ color:'#475569', marginTop:'0.2rem' }}>Asked: {h.note}</div>}
                                {h.answer && <div style={{ color:'#0f1218', marginTop:'0.2rem' }}><strong>Answer:</strong> {h.answer}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
