import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.3rem', boxShadow:'0 2px 16px rgba(15,18,24,0.06)' } };
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.5rem 0.75rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none' };
const money = (n) => '₹' + (Number(n||0)).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' }) : '—';
const METHOD_COLORS = { CASH:'#16a34a', UPI:'#2563eb', CARD:'#7c3aed', CREDIT:'#9ca3af', ONLINE:'#0891b2', RAZORPAY:'#6366f1', OTHER:'#f59e0b' };

function todayISO(d=0){ const t=new Date(); t.setDate(t.getDate()+d); return t.toISOString().slice(0,10); }

export default function Dashboard() {
  const [f, setF] = useState({ franchise_id:'', branch_id:'', date_from: todayISO(-29), date_to: todayISO(0) });
  const [d, setD] = useState({ kpis:{}, daily:[], methods:[], breakdown:[], recent:[] });
  const [loading, setLoading] = useState(true);
  const [franchises, setFranchises] = useState([]);

  useEffect(() => {
    authedFetch('/franchises').then(r=>r.ok?r.json():[]).then(x=>setFranchises(Array.isArray(x)?x:(x.items||[]))).catch(()=>{});
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
    ['Avg / Bill', money(k.avg_bill), '#0891b2'], ['Discount', money(k.discount), '#f59e0b'],
    ['Credit', money(k.credit), '#7c3aed'],
  ];

  return (
    <div>
      {/* filter bar */}
      <div style={{ ...S.card, marginBottom:'1.2rem', display:'flex', gap:'0.8rem', alignItems:'end', flexWrap:'wrap' }}>
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>From</div><input style={inp} type="date" value={f.date_from} onChange={e=>set('date_from',e.target.value)} /></div>
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>To</div><input style={inp} type="date" value={f.date_to} onChange={e=>set('date_to',e.target.value)} /></div>
        <div><div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.25rem' }}>Franchise</div>
          <select style={inp} value={f.franchise_id} onChange={e=>set('franchise_id',e.target.value)}>
            <option value="">All Franchises</option>
            {franchises.map(fr => <option key={fr.id} value={fr.id}>{fr.name}</option>)}
          </select>
        </div>
        <button onClick={load} style={{ background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.3rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>● Apply</button>
        <div style={{ display:'flex', gap:'0.3rem', marginLeft:'auto' }}>
          {[['Today',1],['7d',7],['30d',30],['90d',90]].map(([lbl,dys])=>(
            <button key={lbl} onClick={()=>quick(dys)} style={{ background:'#f0fdf4', color:'#16a34a', border:'1px solid #bbf7d0', borderRadius:'8px', padding:'0.4rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>{lbl}</button>
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
                <div title={`Billed ${money(x.billed)} · Collected ${money(x.collected)}`} style={{ width:'100%', maxWidth:'48px', background:'linear-gradient(180deg,#22c55e,#16a34a)', borderRadius:'5px 5px 0 0', height:`${Math.max(2,(x.billed/maxBilled)*100)}%`, transition:'height 0.3s' }} />
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
                      <div style={{ width:`${b.share}%`, height:'100%', background:'#16a34a' }} />
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
              {['Bill No','Franchise','Status','Total','Paid','Date'].map((h,i)=>(
                <th key={i} style={{ textAlign: i>2&&i<5?'right':'left', padding:'0.65rem 1.3rem', fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.recent.length===0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#8892a4' }}>No bills.</td></tr>}
            {d.recent.map((b,i)=>(
              <tr key={i} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.6rem 1.3rem', fontFamily:'monospace', fontWeight:700, color:'#6366f1', fontSize:'0.8rem' }}>{b.bill_no}</td>
                <td style={{ padding:'0.6rem 1.3rem', color:'#475569', fontSize:'0.82rem' }}>{b.company}</td>
                <td style={{ padding:'0.6rem 1.3rem' }}><span style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1', padding:'0.15rem 0.55rem', borderRadius:'20px', fontSize:'0.68rem', fontWeight:700, textTransform:'capitalize' }}>{b.status}</span></td>
                <td style={{ padding:'0.6rem 1.3rem', textAlign:'right', fontWeight:700, color:'#0f1218', fontSize:'0.82rem' }}>{money(b.total)}</td>
                <td style={{ padding:'0.6rem 1.3rem', textAlign:'right', fontWeight:700, color:'#16a34a', fontSize:'0.82rem' }}>{money(b.paid)}</td>
                <td style={{ padding:'0.6rem 1.3rem', color:'#8892a4', fontSize:'0.76rem' }}>{fmt(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
