import { useEffect, useState } from 'react';
import { authedFetch, auth } from '../services/auth';

const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.3rem', boxShadow:'0 2px 16px rgba(15,18,24,0.06)' } };
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.5rem 0.75rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none' };
const money = (n) => '₹' + (Number(n||0)).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' }) : '—';
const METHOD_COLORS = { CASH:'#16a34a', UPI:'#2563eb', CARD:'#7c3aed', CREDIT:'#9ca3af', ONLINE:'#0891b2', OTHER:'#f59e0b' };

function todayISO(d=0){ const t=new Date(); t.setDate(t.getDate()+d); return t.toISOString().slice(0,10); }

export default function Dashboard() {
  const isFranchise = (auth.user()?.role || '').toLowerCase() === 'franchise';
  const myFranchiseId = isFranchise ? (auth.user()?.franchise_id || '') : '';
  const [f, setF] = useState({ franchise_id: myFranchiseId, branch_id:'', date_from: todayISO(-29), date_to: todayISO(0) });
  const [d, setD] = useState({ kpis:{}, daily:[], methods:[], breakdown:[], recent:[] });
  const [loading, setLoading] = useState(true);
  const [franchises, setFranchises] = useState([]);
  const [detail, setDetail] = useState(null);
  const [dTab, setDTab] = useState('tests');

  const openDetail = (patientId) => {
    if (!patientId) return;
    setDetail('loading'); setDTab('tests');
    authedFetch(`/reports2/patient-detail/${patientId}`).then(r=>r.ok?r.json():null).then(setDetail).catch(()=>setDetail(null));
  };
  const openReportPdf = async (resultId) => {
    if (!resultId) return;
    try { const res = await authedFetch(`/results/${resultId}/pdf`); if(!res.ok) throw new Error();
      const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u,'_blank'); setTimeout(()=>URL.revokeObjectURL(u),60000);
    } catch { alert('Report PDF not available'); }
  };

  useEffect(() => {
    authedFetch('/admin/franchises').then(r=>r.ok?r.json():[]).then(x=>setFranchises(Array.isArray(x)?x:(x.items||[]))).catch(()=>{});
    load();
  }, []); // eslint-disable-line

  const load = () => {
    setLoading(true);
    const qs = Object.entries(f).filter(([,v])=>v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    authedFetch(`/reports2/dashboard${qs?`?${qs}`:''}`).then(r=>r.ok?r.json():{kpis:{},daily:[],methods:[],breakdown:[],recent:[]}).then(x=>{ setD(x); setLoading(false); }).catch(()=>setLoading(false));
  };
  const set = (k,v) => setF(p=>({ ...p, [k]:v }));
  const quick = (days) => { const nf={ ...f, date_from: todayISO(-days+1), date_to: todayISO(0) }; setF(nf); setTimeout(load,0); };

  const k = d.kpis || {};
  const maxBilled = Math.max(1, ...d.daily.map(x=>x.billed||0));
  const totalMethods = d.methods.reduce((s,m)=>s+m.amount, 0) || 1;

  const KPIS = [
    ['Billed', money(k.billed), '#0f1218'], ['Collected', money(k.collected), '#16a34a'],
    ['Balance', money(k.balance), '#dc2626'], ['Bills', k.bills||0, '#6366f1'],
    ['Discount', money(k.discount), '#f59e0b'],
    ['Credit', money(k.credit), '#7c3aed'],
  ];

  return (
    <div>
      {/* filter bar */}
      <div style={{ ...S.card, marginBottom:'1.2rem', display:'flex', gap:'0.8rem', alignItems:'end', flexWrap:'wrap' }}>
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>From</div><input style={inp} type="date" value={f.date_from} onChange={e=>set('date_from',e.target.value)} /></div>
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>To</div><input style={inp} type="date" value={f.date_to} onChange={e=>set('date_to',e.target.value)} /></div>
        {!isFranchise && (
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>Franchise</div>
          <select style={inp} value={f.franchise_id} onChange={e=>set('franchise_id',e.target.value)}>
            <option value="">All Franchises</option>
            {franchises.map(fr => <option key={fr.id} value={fr.id}>{fr.name}</option>)}
          </select>
        </div>
        )}
        <button onClick={load} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.3rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>● Apply</button>
        <div style={{ display:'flex', gap:'0.3rem', marginLeft:'auto' }}>
          {[['Today',1],['7d',7],['30d',30],['90d',90]].map(([lbl,dys])=>(
            <button key={lbl} onClick={()=>quick(dys)} style={{ background:'rgba(249,115,22,0.08)', color:'#f97316', border:'1px solid rgba(249,115,22,0.25)', borderRadius:'8px', padding:'0.4rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'0.8rem', marginBottom:'1.2rem' }}>
        {KPIS.map(([label,val,col])=>(
          <div key={label} style={{ ...S.card, padding:'1.1rem 1.3rem', borderTop:`3px solid ${col}` }}>
            <div style={{ fontSize:'1.45rem', fontWeight:800, color:col, fontFamily:'Manrope,sans-serif' }}>{val}</div>
            <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600, marginTop:'0.2rem' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* daily revenue + payment methods */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'1.2rem', marginBottom:'1.2rem' }}>
        <div style={S.card}>
          <div style={{ fontWeight:800, color:'#0f1218', marginBottom:'1rem', fontFamily:'Manrope,sans-serif' }}>Daily Revenue <span style={{ color:'#8892a4', fontWeight:500, fontSize:'0.78rem' }}>({d.daily.length} days)</span></div>
          {d.daily.length===0 && <div style={{ color:'#8892a4', fontSize:'0.85rem', padding:'2rem 0', textAlign:'center' }}>{loading?'Loading…':'No data for this range.'}</div>}
          <div style={{ display:'flex', alignItems:'flex-end', gap:'0.5rem', height:'200px', paddingTop:'1.5rem' }}>
            {d.daily.map((x,i)=>(
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', height:'100%' }}>
                <div style={{ fontSize:'0.6rem', color:'#475569', fontWeight:700, marginBottom:'0.2rem' }}>{x.billed>0?money(x.billed).replace('₹','₹'):''}</div>
                <div title={`Billed ${money(x.billed)} · Collected ${money(x.collected)}`} style={{ width:'100%', maxWidth:'48px', background:'linear-gradient(180deg,#fbbf24,#f97316)', borderRadius:'5px 5px 0 0', height:`${Math.max(2,(x.billed/maxBilled)*100)}%`, transition:'height 0.3s' }} />
                <div style={{ fontSize:'0.6rem', color:'#8892a4', marginTop:'0.3rem', whiteSpace:'nowrap' }}>{x.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.card}>
          <div style={{ fontWeight:800, color:'#0f1218', marginBottom:'1rem', fontFamily:'Manrope,sans-serif' }}>Payment Methods</div>
          {d.methods.length===0 && <div style={{ color:'#8892a4', fontSize:'0.85rem' }}>No payments.</div>}
          {d.methods.map((m,i)=>{
            const pct = (m.amount/totalMethods*100);
            const col = METHOD_COLORS[m.method] || '#f59e0b';
            return (
              <div key={i} style={{ marginBottom:'0.9rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.78rem', marginBottom:'0.3rem' }}>
                  <span style={{ fontWeight:700, color:'#0f1218' }}>{m.method}</span>
                  <span style={{ color:'#475569' }}>{money(m.amount)} ({pct.toFixed(1)}%)</span>
                </div>
                <div style={{ height:'7px', background:'#f1f3f7', borderRadius:'10px', overflow:'hidden' }}>
                  <div style={{ width:`${pct}%`, height:'100%', background:col, borderRadius:'10px' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* franchise breakdown */}
      <div style={{ ...S.card, marginBottom:'1.2rem', padding:0, overflow:'hidden' }}>
        <div style={{ fontWeight:800, color:'#0f1218', padding:'1.1rem 1.3rem 0.8rem', fontFamily:'Manrope,sans-serif' }}>Franchise Breakdown</div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderTop:'1px solid #eef1f6', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Franchise','Bills','Billed','Credit','Collected','Avg/Bill','Share'].map((h,i)=>(
                <th key={i} style={{ textAlign: i===0?'left':'right', padding:'0.65rem 1.3rem', fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.breakdown.length===0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#8892a4' }}>No data.</td></tr>}
            {d.breakdown.map((b,i)=>(
              <tr key={i} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.7rem 1.3rem', fontWeight:600, color:'#0f1218', fontSize:'0.84rem' }}>{b.company}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right', color:'#475569', fontSize:'0.82rem' }}>{b.bills}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right', fontWeight:700, color:'#0f1218', fontSize:'0.82rem' }}>{money(b.billed)}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right', color: b.credit>0?'#dc2626':'#8892a4', fontSize:'0.82rem' }}>{money(b.credit)}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right', fontWeight:700, color:'#16a34a', fontSize:'0.82rem' }}>{money(b.collected)}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right', color:'#475569', fontSize:'0.82rem' }}>{money(b.avg_bill)}</td>
                <td style={{ padding:'0.7rem 1.3rem', textAlign:'right' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'0.5rem' }}>
                    <div style={{ width:'60px', height:'6px', background:'#f1f3f7', borderRadius:'10px', overflow:'hidden' }}>
                      <div style={{ width:`${b.share}%`, height:'100%', background:'#f97316' }} />
                    </div>
                    <span style={{ fontSize:'0.74rem', color:'#475569', fontWeight:700, minWidth:'42px' }}>{b.share}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* recent bills */}
      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <div style={{ fontWeight:800, color:'#0f1218', padding:'1.1rem 1.3rem 0.8rem', fontFamily:'Manrope,sans-serif' }}>Recent Bills</div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderTop:'1px solid #eef1f6', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Bill No','Patient ID','Barcode','Franchise','Status','Total','Paid','Date'].map((h,i)=>(
                <th key={i} style={{ textAlign: i>4&&i<7?'right':'left', padding:'0.65rem 1.3rem', fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.recent.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#8892a4' }}>No bills.</td></tr>}
            {d.recent.map((b,i)=>{
              const click = ()=>openDetail(b.patient_id);
              const link = { cursor:'pointer', textDecoration:'underline' };
              return (
                <tr key={i} style={{ borderBottom:'1px solid #f4f6fa' }}>
                  <td onClick={click} style={{ padding:'0.6rem 1.3rem', fontFamily:'monospace', fontWeight:700, color:'#f97316', fontSize:'0.8rem', ...link }}>{b.bill_no}</td>
                  <td onClick={click} style={{ padding:'0.6rem 1.3rem', fontWeight:700, color:'#6366f1', fontSize:'0.8rem', ...link }}>{b.patient_id?`#${b.patient_id}`:'—'}</td>
                  <td onClick={click} style={{ padding:'0.6rem 1.3rem', fontFamily:'monospace', color:'#6366f1', fontSize:'0.8rem', ...(b.barcode?link:{}) }}>{b.barcode||'—'}</td>
                  <td style={{ padding:'0.6rem 1.3rem', color:'#475569', fontSize:'0.82rem' }}>{b.company}</td>
                  <td style={{ padding:'0.6rem 1.3rem' }}><span style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', padding:'0.15rem 0.55rem', borderRadius:'20px', fontSize:'0.68rem', fontWeight:700, textTransform:'capitalize' }}>{b.status}</span></td>
                  <td style={{ padding:'0.6rem 1.3rem', textAlign:'right', fontWeight:700, color:'#0f1218', fontSize:'0.82rem' }}>{money(b.total)}</td>
                  <td style={{ padding:'0.6rem 1.3rem', textAlign:'right', fontWeight:700, color:'#16a34a', fontSize:'0.82rem' }}>{money(b.paid)}</td>
                  <td style={{ padding:'0.6rem 1.3rem', color:'#8892a4', fontSize:'0.76rem' }}>{fmt(b.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* drill-down detail modal */}
      {detail && (
        <div onClick={()=>setDetail(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.6rem', width:'620px', maxWidth:'95vw', maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            {detail==='loading' ? <div style={{ padding:'2rem', textAlign:'center', color:'#8892a4' }}>Loading…</div> : (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
                  <div>
                    <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.15rem', color:'#0f1218' }}>{detail.patient_name}</div>
                    <div style={{ color:'#8892a4', fontSize:'0.8rem', fontFamily:'monospace' }}>#{detail.patient_id} · {detail.barcode} · {detail.status}</div>
                    <div style={{ marginTop:'0.4rem', fontSize:'0.82rem', color:'#475569' }}>Billed {money(detail.billed)} · Collected <span style={{ color:'#16a34a', fontWeight:700 }}>{money(detail.collected)}</span> · Balance <span style={{ color: detail.balance>0?'#dc2626':'#8892a4', fontWeight:700 }}>{money(detail.balance)}</span></div>
                  </div>
                  <button onClick={()=>setDetail(null)} style={{ border:'none', background:'transparent', fontSize:'1.4rem', color:'#c4cad6', cursor:'pointer' }}>×</button>
                </div>
                {/* tabs */}
                <div style={{ display:'flex', gap:'0.4rem', marginBottom:'0.9rem', borderBottom:'1.5px solid #eef1f6' }}>
                  {[['tests',`Tests (${detail.tests?.length||0})`],['payments',`Payments (${detail.payment_history?.length||0})`],['history',`History (${detail.clinical_history?.length||0})`]].map(([key,label])=>{
                    const active=dTab===key;
                    return <button key={key} onClick={()=>setDTab(key)} style={{ background:'transparent', border:'none', borderBottom:active?'2px solid #f97316':'2px solid transparent', color:active?'#f97316':'#8892a4', fontWeight:700, fontSize:'0.8rem', padding:'0.4rem 0.8rem', cursor:'pointer', marginBottom:'-1.5px', fontFamily:'Manrope,sans-serif' }}>{label}</button>;
                  })}
                </div>
                {dTab==='tests' && (detail.tests||[]).map((t,i)=>(
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.5rem', borderBottom:'1px solid #f1f3f7', fontSize:'0.82rem', gap:'1rem' }}>
                    <span style={{ color:'#0f1218', fontWeight:600, flex:1 }}>{t.test_name}<span style={{ color:'#8892a4', fontWeight:400 }}> · {t.doctor||'No doctor'}</span></span>
                    <span style={{ color:'#475569', fontWeight:700 }}>{money(t.price)}</span>
                    {t.result_id ? <button onClick={()=>openReportPdf(t.result_id)} style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', border:'1px solid rgba(249,115,22,0.3)', borderRadius:'7px', padding:'0.3rem 0.7rem', fontWeight:700, cursor:'pointer', fontSize:'0.72rem', whiteSpace:'nowrap' }}>📄 PDF</button> : <span style={{ color:'#c4cad6', fontSize:'0.7rem' }}>No report</span>}
                  </div>
                ))}
                {dTab==='payments' && (detail.payment_history||[]).map((ph,i)=>{
                  const col = ph.status==='success'?'#16a34a':(['failed','timeout','cancelled'].includes(ph.status))?'#dc2626':'#b45309';
                  return <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.45rem 0.5rem', borderBottom:'1px solid #f1f3f7', fontSize:'0.8rem', gap:'1rem' }}>
                    <div style={{ flex:1 }}><span style={{ minWidth:'58px', display:'inline-block', fontWeight:800, color:col, textTransform:'uppercase', fontSize:'0.62rem' }}>{ph.status}</span><span style={{ color:'#0f1218', fontWeight:600 }}>{ph.method||ph.kind}</span><span style={{ color:'#475569' }}> · {money(ph.amount)}</span>{ph.error && <div style={{ color:'#dc2626', fontSize:'0.7rem' }}>{ph.error.slice(0,90)}</div>}</div>
                    <span style={{ color:'#8892a4', fontSize:'0.72rem', whiteSpace:'nowrap' }}>{fmt(ph.at)}</span>
                  </div>;
                })}
                {dTab==='history' && ((detail.clinical_history||[]).length===0
                  ? <div style={{ color:'#8892a4', fontSize:'0.8rem', padding:'0.5rem' }}>No history requests.</div>
                  : (detail.clinical_history||[]).map((h,i)=>(
                    <div key={i} style={{ padding:'0.5rem 0.8rem', marginBottom:'0.4rem', borderRadius:'8px', fontSize:'0.8rem', background: h.status==='answered'?'rgba(22,163,74,0.06)':'rgba(245,158,11,0.06)' }}>
                      <span style={{ fontWeight:700, color: h.status==='answered'?'#16a34a':'#b45309' }}>{(h.asked_for||[]).join(', ')||'History request'}</span>
                      {h.note && <span style={{ color:'#475569' }}> — asked: {h.note}</span>}
                      {h.answer && <div style={{ color:'#0f1218', marginTop:'0.2rem' }}><strong>Answer:</strong> {h.answer}</div>}
                    </div>
                  )))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
