import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium' }) : '—';
const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', boxSizing:'border-box' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };

export default function MyCommission() {
  const [data, setData]         = useState(null);   // null = loading
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const load = (df, dt) => {
    setData(null);
    const qs = new URLSearchParams();
    if (df) qs.set('date_from', df);
    if (dt) qs.set('date_to', dt);
    authedFetch(`/commission/me/ledger?${qs.toString()}`).then(r=>r.ok?r.json():null).then(setData).catch(()=>setData(null));
  };
  useEffect(() => { load('', ''); }, []);

  const applyDates = () => load(dateFrom, dateTo);
  const clearDates = () => { setDateFrom(''); setDateTo(''); load('', ''); };

  if (data === null) return <div style={{ color:'#8892a4', padding:'2rem' }}>Loading…</div>;

  if (!data.matched) {
    return (
      <div>
        <div style={{ marginBottom:'1.5rem' }}>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>My Commission</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>My Commission</h1>
        </div>
        <div style={{ ...S.card, textAlign:'center', padding:'3rem', color:'#8892a4' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>🩺</div>
          You're not currently registered as a referral doctor, so there's no commission to show here.
          <div style={{ fontSize:'0.8rem', marginTop:'0.5rem' }}>If you also refer patients to the lab, ask your Lab Admin to register you under Doctor Commission.</div>
        </div>
      </div>
    );
  }

  const { summary, entries, doctor } = data;
  return (
    <div>
      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>My Commission</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>{doctor.name}</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{doctor.commission_percent}% commission per validated report</p>
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
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <div style={{ fontWeight:800, color:'#0f1218', padding:'1.1rem 1.3rem 0.8rem', fontFamily:'Manrope,sans-serif' }}>Ledger · per test earned</div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Date','Bill No','Barcode','Test','Amount','%','Commission','Paid?'].map(h => (
                <th key={h} style={{ textAlign: ['Amount','%','Commission'].includes(h)?'right':'left', padding:'0.8rem 1.1rem', fontSize:'0.63rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No commission entries in this range.</td></tr>
            )}
            {entries.map(e => (
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
      </div>
    </div>
  );
}
