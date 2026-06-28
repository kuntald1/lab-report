import { useState } from 'react';
import { api } from '../services/api';

const flagColor  = f => f==='H'?'#dc2626':f==='L'?'#2563eb':'#16a34a';
const flagBg     = f => f==='H'?'#fef2f2':f==='L'?'#eff6ff':'#f0fdf4';
const flagBorder = f => f==='H'?'#fecaca':f==='L'?'#bfdbfe':'#bbf7d0';
const flagText   = f => f==='H'?'HIGH':f==='L'?'LOW':'OK';

export default function PublicReport() {
  const params = new URLSearchParams(window.location.search);
  const rid = params.get('rid');
  const k   = params.get('k') || '';

  const [password, setPassword] = useState('');
  const [data, setData]         = useState(null);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const submit = async () => {
    if (!password.trim()) { setError('Enter the phone number or barcode'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${api.BASE}/public/report/${rid}/view`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: k, password: password.trim() }),
      });
      if (res.status === 401) throw new Error('Incorrect phone number or barcode. Please try again.');
      if (res.status === 403) throw new Error('This link is invalid or has expired.');
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'Could not open the report.'); }
      setData(await res.json());
    } catch (e) { setError(String(e.message || 'Something went wrong')); }
    setLoading(false);
  };

  const downloadPdf = () => {
    const url = `${api.BASE}/public/report/${rid}/pdf?token=${encodeURIComponent(k)}&password=${encodeURIComponent(password.trim())}`;
    window.open(url, '_blank');
  };

  const wrap = { minHeight:'100vh', background:'linear-gradient(160deg,#f5f9f5,#eef4ff)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'2.5rem 1rem', fontFamily:'Manrope,system-ui,sans-serif' };
  const card = { background:'#fff', borderRadius:'18px', boxShadow:'0 12px 40px rgba(15,18,24,0.12)', width:'520px', maxWidth:'96vw', overflow:'hidden' };

  if (!rid || !k) {
    return <div style={wrap}><div style={{ ...card, padding:'2.5rem', textAlign:'center', color:'#8892a4' }}>Invalid report link.</div></div>;
  }

  // ---- password gate ----
  if (!data) {
    return (
      <div style={wrap}>
        <div style={{ ...card, padding:'2.5rem' }}>
          <div style={{ textAlign:'center', marginBottom:'1.6rem' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#15803d' }}>🔬 MediCloud</div>
            <div style={{ fontSize:'0.8rem', color:'#8892a4', marginTop:'0.2rem' }}>Secure lab report access</div>
          </div>
          <div style={{ background:'rgba(22,163,74,0.06)', border:'1px solid rgba(22,163,74,0.18)', borderRadius:'12px', padding:'1rem 1.2rem', marginBottom:'1.4rem', fontSize:'0.85rem', color:'#15803d', textAlign:'center' }}>
            🔒 To protect patient privacy, enter the patient's <strong>phone number</strong> or <strong>barcode</strong> to view this report.
          </div>
          <input
            value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter' && submit()}
            placeholder="Phone number or barcode"
            style={{ width:'100%', padding:'0.8rem 1rem', borderRadius:'10px', border:'1.5px solid #e8ecf4', fontSize:'0.95rem', outline:'none', boxSizing:'border-box', marginBottom:'0.8rem' }} />
          {error && <div style={{ color:'#dc2626', fontSize:'0.82rem', marginBottom:'0.8rem' }}>{error}</div>}
          <button onClick={submit} disabled={loading}
            style={{ width:'100%', padding:'0.85rem', borderRadius:'10px', border:'none', cursor:'pointer', fontWeight:700, fontSize:'0.95rem', color:'#fff', background:'linear-gradient(135deg,#16a34a,#22c55e)', fontFamily:'Manrope,sans-serif' }}>
            {loading ? 'Verifying…' : 'View Report'}
          </button>
        </div>
      </div>
    );
  }

  // ---- report ----
  const fmt = d => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ background:'linear-gradient(135deg,#15803d,#16a34a)', color:'#fff', padding:'1.5rem 1.8rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:'1.2rem', fontWeight:800 }}>🔬 MediCloud</div>
            <div style={{ fontSize:'0.78rem', opacity:0.9 }}>Lab Report #{data.id}</div>
          </div>
          <button onClick={downloadPdf} style={{ background:'rgba(255,255,255,0.18)', color:'#fff', border:'1px solid rgba(255,255,255,0.4)', borderRadius:'9px', padding:'0.55rem 1.1rem', fontWeight:700, cursor:'pointer', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif' }}>📄 Download PDF</button>
        </div>

        <div style={{ padding:'1.8rem' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.8rem', background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'12px', padding:'1.1rem', marginBottom:'1.4rem' }}>
            {[
              ['Patient', data.patient_name],
              ['Barcode', data.barcode],
              ['Age / Gender', `${data.age||'—'} / ${data.gender||'—'}`],
              ['Doctor', data.doctor || '—'],
              ['Report Date', fmt(data.created_at)],
              ['Status', data.status],
            ].map(([l,v]) => (
              <div key={l}>
                <div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>{l}</div>
                <div style={{ fontSize:'0.88rem', color:'#0f1218', fontWeight:600, marginTop:'0.1rem' }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.8rem' }}>
            Test Results ({(data.parameters||[]).length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.45rem' }}>
            {(data.parameters||[]).map((p,i) => (
              <div key={i} style={{ background:flagBg(p.flag), border:`1px solid ${flagBorder(p.flag)}`, borderRadius:'10px', padding:'0.75rem 0.95rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#0f1218' }}>{p.name}</div>
                  <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>Ref: {p.ref_min}–{p.ref_max} {p.unit}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:'1.05rem', fontWeight:800, color:flagColor(p.flag) }}>{p.value}</div>
                    <div style={{ fontSize:'0.65rem', color:'#8892a4' }}>{p.unit}</div>
                  </div>
                  <span style={{ fontSize:'0.62rem', background:flagColor(p.flag), color:'#fff', padding:'0.2rem 0.5rem', borderRadius:'4px', fontWeight:700 }}>{flagText(p.flag)}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign:'center', marginTop:'1.6rem', fontSize:'0.68rem', color:'#b0b7c3' }}>
            Verified via MediCloud · This report is computer-generated.
          </div>
        </div>
      </div>
    </div>
  );
}
