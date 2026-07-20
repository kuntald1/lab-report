import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.55rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.66rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';

export default function ValidateHistory() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');

  const load = () => {
    setLoading(true);
    const qs = [];
    if (from) qs.push(`date_from=${from}`);
    if (to)   qs.push(`date_to=${to}`);
    authedFetch(`/reports/validated${qs.length?`?${qs.join('&')}`:''}`).then(r=>r.ok?r.json():[]).then(d=>{ setRows(d); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line

  return (
    <div>
      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(22,163,74,0.08)', border:'1px solid rgba(22,163,74,0.2)', color:'#16a34a', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Doctor</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Validate History</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{rows.length} report(s) you have validated</p>
      </div>

      {/* date filter */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'flex', gap:'0.8rem', alignItems:'end', flexWrap:'wrap' }}>
          <div style={{ width:'180px' }}><label style={lbl}>From</label><input style={inp} type="date" value={from} onChange={e=>setFrom(e.target.value)} /></div>
          <div style={{ width:'180px' }}><label style={lbl}>To</label><input style={inp} type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
          <button onClick={load} style={{ background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.4rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply</button>
          <button onClick={()=>{ setFrom(''); setTo(''); setTimeout(load,0); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
        </div>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Accession No.','Patient','Age/Gender','Status','Validated At'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.75rem 1.1rem', fontSize:'0.64rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>{loading?'Loading…':'No validated reports in this range.'}</td></tr>}
            {rows.map(p => (
              <tr key={p.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.8rem 1.1rem', fontFamily:'monospace', fontWeight:700, color:'#16a34a', fontSize:'0.8rem' }}>{p.barcode}</td>
                <td style={{ padding:'0.8rem 1.1rem', fontFamily:'monospace', color:'#c2410c', fontSize:'0.76rem' }}>{(p.accession_numbers||[]).join(', ') || '—'}</td>
                <td style={{ padding:'0.8rem 1.1rem', fontWeight:600, color:'#0f1218', fontSize:'0.85rem' }}>{p.patient_name}</td>
                <td style={{ padding:'0.8rem 1.1rem', color:'#8892a4', fontSize:'0.82rem' }}>{p.age||'—'} / {p.gender||'—'}</td>
                <td style={{ padding:'0.8rem 1.1rem' }}><span style={{ background:'rgba(15,118,110,0.12)', color:'#0f766e', padding:'0.2rem 0.6rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:700 }}>{p.status}</span></td>
                <td style={{ padding:'0.8rem 1.1rem', color:'#475569', fontSize:'0.78rem' }}>{fmtDate(p.validated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
