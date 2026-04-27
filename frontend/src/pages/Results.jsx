import { useEffect, useState } from 'react';
import { api } from '../services/api';

const S = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const flagColor  = f => f==='H'?'#dc2626':f==='L'?'#2563eb':'#16a34a';
const flagBg     = f => f==='H'?'#fef2f2':f==='L'?'#eff6ff':'#f0fdf4';
const flagBorder = f => f==='H'?'#fecaca':f==='L'?'#bfdbfe':'#bbf7d0';

export default function Results() {
  const [results, setResults] = useState([]);
  const [sel,     setSel]     = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getResults().then(setResults).catch(()=>{}); }, []);

  const downloadPDF = async (id) => {
    setLoading(true);
    try {
      const r = await fetch(`http://localhost:8001/api/results/${id}/pdf`);
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url; a.download=`MediCloud_Report_${id}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch { alert('PDF failed'); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Lab Reports</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Results</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{results.length} results — click to view details</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: sel ? '1fr 1.1fr' : '1fr', gap:'1.5rem', alignItems:'start' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
          {results.length === 0 && (
            <div style={{ ...S.card, padding:'3rem', textAlign:'center', color:'#8892a4' }}>
              <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>🧪</div>
              No results yet. Use the Simulator to generate test data.
            </div>
          )}
          {results.map(r => (
            <div key={r.id} onClick={() => setSel(r)} style={{
              ...S.card, padding:'1rem 1.3rem', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', transition:'all 0.15s',
              background: sel?.id===r.id ? '#fffbf7' : '#fff',
              border: sel?.id===r.id ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid #e8ecf4',
              boxShadow: sel?.id===r.id ? '0 4px 20px rgba(249,115,22,0.12)' : '0 2px 8px rgba(15,18,24,0.05)',
            }}
              onMouseEnter={e=>{ if(sel?.id!==r.id){ e.currentTarget.style.background='#fafbfc'; e.currentTarget.style.borderColor='#d1d5db'; }}}
              onMouseLeave={e=>{ if(sel?.id!==r.id){ e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#e8ecf4'; }}}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.8rem' }}>
                <div style={{ width:'40px', height:'40px', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.15)', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem' }}>🧪</div>
                <div>
                  <div style={{ fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{r.patient_name}</div>
                  <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.1rem' }}>
                    {r.test_name} · <span style={{ color:'#f97316', fontWeight:700 }}>{r.barcode}</span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <span style={{ fontSize:'0.68rem', background:'rgba(34,197,94,0.1)', color:'#16a34a', padding:'0.2rem 0.65rem', borderRadius:'20px', fontWeight:700, border:'1px solid rgba(34,197,94,0.2)' }}>{r.status}</span>
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
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button onClick={() => downloadPDF(sel.id)} disabled={loading} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'8px', padding:'0.5rem 1rem', cursor:'pointer', fontSize:'0.78rem', fontWeight:700, fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 12px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  {loading?'⏳':'📄'} {loading?'Generating...':'Download PDF'}
                </button>
                <button onClick={()=>setSel(null)} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'8px', padding:'0.5rem 0.7rem', cursor:'pointer' }}>✕</button>
              </div>
            </div>

            <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'1rem', marginBottom:'1.2rem' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                {[
                  { label:'Patient', value:sel.patient_name },
                  { label:'Barcode', value:sel.barcode },
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

            <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.8rem' }}>
              Parameters ({sel.parsed_data?.parameters?.length||0})
            </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
