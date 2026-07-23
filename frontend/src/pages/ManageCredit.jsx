import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium' }) : '—';
const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const TYPE_META = {
  bill:       { label:'Invoice',    color:'#dc2626', sign:'+' },   // increases outstanding
  payment:    { label:'Payment',    color:'#16a34a', sign:'−' },   // reduces outstanding
  adjustment: { label:'Adjustment', color:'#7c3aed', sign:'±' },
};

export default function ManageCredit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState(null);   // { kind:'success'|'error', title, msg }

  const load = () => { setLoading(true); authedFetch('/b2b/my-ledger').then(r=>r.ok?r.json():null).then(d=>{ setData(d); setLoading(false); }).catch(()=>setLoading(false)); };
  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ color:'#8892a4', padding:'2rem' }}>Loading…</div>;
  if (!data)   return <div style={{ color:'#8892a4', padding:'2rem' }}>Could not load credit details.</div>;

  const limit = Number(data.organization?.credit_limit || 0);
  const outstanding = Number(data.outstanding || 0);
  const overLimit = outstanding > limit;          // matches the gating rule (locked when over)
  const available = Math.max(0, limit - outstanding);

  const ensureRzp = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.body.appendChild(s);
  });

  const payOutstanding = async () => {
    setPaying(true);
    try {
      await ensureRzp();
      const ores = await authedFetch('/b2b/pay/razorpay/order', { method:'POST' });
      if (!ores.ok) { const e = await ores.json().catch(()=>({})); throw new Error(e.detail || 'Could not start payment'); }
      const order = await ores.json();
      const rzp = new window.Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: { name: data.organization?.name || '', contact: data.organization?.phone || '' },
        theme: { color: '#f97316' },
        handler: async (resp) => {
          try {
            const vres = await authedFetch('/b2b/pay/razorpay/verify', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              }),
            });
            const v = await vres.json().catch(()=>({}));
            if (!vres.ok) throw new Error(v.detail || 'Verification failed');
            load();   // refresh outstanding + ledger; lock clears automatically
            setNotice({ kind:'success', title:'Payment successful',
              msg: v.locked ? `Paid ${inr(v.paid)}. Still over limit — pay the remaining ${inr(v.outstanding)} to unlock reports.`
                            : `Paid ${inr(v.paid)}. Your reports are now unlocked.` });
          } catch (e) { setNotice({ kind:'error', title:'Verification failed', msg:String(e.message || 'Please try again.') }); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.on('payment.failed', (r) => setNotice({ kind:'error', title:'Payment failed', msg:(r.error?.description || 'The payment could not be completed.') }));
      rzp.open();
    } catch (e) {
      setNotice({ kind:'error', title:'Could not start payment', msg:String(e.message || 'Please try again.') });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div>
      {notice && (
        <div onClick={()=>setNotice(null)} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(15,18,24,0.5)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'18px', boxShadow:'0 20px 60px rgba(15,18,24,0.25)', width:'400px', maxWidth:'92vw', padding:'2rem', textAlign:'center', animation:'noticePop 0.18s ease-out' }}>
            <div style={{ width:'62px', height:'62px', margin:'0 auto 1rem', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2rem', background: notice.kind==='success' ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)' }}>{notice.kind==='success' ? '✓' : '⚠️'}</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.15rem', color: notice.kind==='success' ? '#16a34a' : '#dc2626', marginBottom:'0.5rem' }}>{notice.title}</div>
            <div style={{ fontSize:'0.88rem', color:'#475569', lineHeight:1.55, marginBottom:'1.5rem' }}>{notice.msg}</div>
            <button onClick={()=>setNotice(null)} style={{ background: notice.kind==='success' ? 'linear-gradient(135deg,#16a34a,#22c55e)' : 'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 2.2rem', fontWeight:700, fontSize:'0.88rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>OK</button>
          </div>
          <style>{`@keyframes noticePop { from { opacity:0; transform:scale(0.94) translateY(8px);} to { opacity:1; transform:scale(1) translateY(0);} }`}</style>
        </div>
      )}
      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Credit</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Manage Credit</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{data.organization?.name}</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
        <div style={{ ...S.card, borderTop:`3px solid ${overLimit?'#dc2626':'#f97316'}` }}>
          <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Outstanding</div>
          <div style={{ fontSize:'1.7rem', fontWeight:800, color: overLimit?'#dc2626':'#0f1218', marginTop:'0.3rem' }}>{inr(outstanding)}</div>
        </div>
        <div style={{ ...S.card }}>
          <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Credit Limit</div>
          <div style={{ fontSize:'1.7rem', fontWeight:800, color:'#0f1218', marginTop:'0.3rem' }}>{inr(limit)}</div>
        </div>
        <div style={{ ...S.card }}>
          <div style={{ fontSize:'0.7rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Available</div>
          <div style={{ fontSize:'1.7rem', fontWeight:800, color: overLimit?'#dc2626':'#16a34a', marginTop:'0.3rem' }}>{inr(available)}</div>
        </div>
      </div>

      {overLimit && (
        <div style={{ background:'rgba(220,38,38,0.06)', border:'1px solid rgba(220,38,38,0.25)', borderRadius:'12px', padding:'0.9rem 1.2rem', marginBottom:'1.5rem', color:'#b91c1c', fontSize:'0.85rem', fontWeight:600 }}>
          Outstanding has crossed the credit limit. Report values stay locked until the balance is brought within limit.
        </div>
      )}

      <div style={{ ...S.card, marginBottom:'1.5rem', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.8rem' }}>
        <div>
          <div style={{ fontWeight:800, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>Pay Outstanding</div>
          <div style={{ fontSize:'0.78rem', color:'#8892a4', marginTop:'0.2rem' }}>Clear your balance online via Razorpay.</div>
        </div>
        <button onClick={payOutstanding} disabled={paying} style={{ background: paying ? '#e8ecf4' : 'linear-gradient(135deg,#3b82f6,#2563eb)', color: paying ? '#94a3b8' : '#fff', border:'none', borderRadius:'10px', padding:'0.7rem 1.6rem', fontWeight:700, cursor: paying?'not-allowed':'pointer', fontFamily:'Manrope,sans-serif' }}>{paying ? 'Processing…' : `💳 Pay ${inr(outstanding)}`}</button>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <div style={{ fontWeight:800, color:'#0f1218', padding:'1.1rem 1.3rem 0.8rem', fontFamily:'Manrope,sans-serif' }}>Ledger · debit &amp; credit</div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Type','Date','Reference','Amount','Balance'].map(h => (
                <th key={h} style={{ textAlign: h==='Amount'||h==='Balance'?'right':'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.entries.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No ledger entries yet.</td></tr>
            )}
            {data.entries.map(e => {
              const m = TYPE_META[e.type] || { label:e.type, color:'#475569', sign:'' };
              return (
                <tr key={e.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                  <td style={{ padding:'0.85rem 1.3rem' }}><span style={{ background:m.color+'18', color:m.color, padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>{m.label}</span></td>
                  <td style={{ padding:'0.85rem 1.3rem', color:'#8892a4', fontSize:'0.82rem' }}>{fmt(e.created_at)}</td>
                  <td style={{ padding:'0.85rem 1.3rem', color:'#475569', fontSize:'0.82rem', fontFamily:'monospace' }}>{e.ref || '—'}</td>
                  <td style={{ padding:'0.85rem 1.3rem', textAlign:'right', fontWeight:700, color:m.color, whiteSpace:'nowrap' }}>{m.sign}&nbsp;{inr(e.amount)}</td>
                  <td style={{ padding:'0.85rem 1.3rem', textAlign:'right', color:'#0f1218', fontWeight:600 }}>{e.balance_after!=null ? inr(e.balance_after) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
