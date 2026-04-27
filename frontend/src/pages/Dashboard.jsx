import { useEffect, useState } from 'react';
import { api } from '../services/api';

const S = {
  card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.2rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)', position:'relative', overflow:'hidden' },
};

function StatCard({ icon, label, value, color, top }) {
  return (
    <div style={{ ...S.card }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:top }}></div>
      <div style={{ width:'38px', height:'38px', borderRadius:'10px', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', marginBottom:'0.8rem' }}>{icon}</div>
      <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.9rem', fontWeight:800, color:'#0f1218', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.25rem', fontWeight:500 }}>{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState({ devices:0, online:0, patients:0, results:0 });
  useEffect(() => {
    Promise.all([api.getDevices(), api.getPatients(), api.getResults()])
      .then(([d,p,r]) => setStats({ devices:d.length, online:d.filter(x=>x.is_online).length, patients:p.length, results:r.length }))
      .catch(()=>{});
  }, []);

  return (
    <div>
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Overview</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Dashboard</h1>
        <p style={{ color:'#8892a4', marginTop:'0.2rem', fontSize:'0.85rem', fontWeight:400 }}>Welcome back, Kuntal. Here's what's happening in your lab.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'2rem' }}>
        <StatCard icon="🔬" label="Total Devices"    value={stats.devices}  color="rgba(249,115,22,0.1)"  top="linear-gradient(90deg,#f97316,#fbbf24)" />
        <StatCard icon="🟢" label="Online Devices"   value={stats.online}   color="rgba(34,197,94,0.1)"   top="linear-gradient(90deg,#22c55e,#84cc16)" />
        <StatCard icon="👤" label="Total Patients"   value={stats.patients} color="rgba(59,130,246,0.1)"  top="linear-gradient(90deg,#3b82f6,#06b6d4)" />
        <StatCard icon="🧪" label="Total Results"    value={stats.results}  color="rgba(168,85,247,0.1)"  top="linear-gradient(90deg,#a855f7,#ec4899)" />
      </div>

      {/* Data Flow */}
      <div style={{ ...S.card, marginBottom:'1.5rem' }}>
        <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', marginBottom:'1.3rem', fontSize:'0.95rem' }}>📡 Live Data Flow</div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.8rem', flexWrap:'wrap' }}>
          {[
            { label:'Lab Machine', sub:'ASTM Protocol', icon:'🔬', bg:'rgba(249,115,22,0.08)', border:'rgba(249,115,22,0.2)', textC:'#f97316' },
            { arrow:true },
            { label:'TCP Connection', sub:'Port 5600', icon:'⚡', bg:'rgba(249,115,22,0.05)', border:'rgba(249,115,22,0.15)', textC:'#f97316' },
            { arrow:true },
            { label:'MediCloud Parser', sub:'Auto Parse + Save', icon:'🧠', bg:'#1a1f2e', border:'#1a1f2e', textC:'#fff', dark:true },
            { arrow:true },
            { label:'PDF Report', sub:'Download Instantly', icon:'📄', bg:'rgba(34,197,94,0.08)', border:'rgba(34,197,94,0.2)', textC:'#16a34a' },
          ].map((n,i) => n.arrow
            ? <div key={i} style={{ color:'#e8ecf4', fontSize:'1.3rem' }}>→</div>
            : <div key={i} style={{ flex:1, minWidth:'120px', background:n.bg, border:`1.5px solid ${n.border}`, borderRadius:'12px', padding:'1rem', textAlign:'center' }}>
                <div style={{ fontSize:'1.5rem', marginBottom:'0.4rem' }}>{n.icon}</div>
                <div style={{ fontSize:'0.82rem', fontWeight:700, color:n.dark?'#fff':n.textC, fontFamily:'Manrope,sans-serif' }}>{n.label}</div>
                <div style={{ fontSize:'0.68rem', color:n.dark?'rgba(255,255,255,0.5)':n.textC, opacity:0.75, marginTop:'0.15rem' }}>{n.sub}</div>
              </div>
          )}
        </div>
      </div>

      {/* Quick Start */}
      <div style={{ ...S.card }}>
        <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', marginBottom:'1.2rem', fontSize:'0.95rem' }}>🚀 Quick Start Guide</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem' }}>
          {[
            { step:'01', icon:'🔬', title:'Add Device',     desc:'Register your lab analyser with IP and port' },
            { step:'02', icon:'👤', title:'Register Patient',desc:'Add patient — barcode auto-generated' },
            { step:'03', icon:'⚡', title:'Simulate Data',   desc:'Test with ASTM simulator without hardware' },
            { step:'04', icon:'📄', title:'Download PDF',    desc:'View results and download instant PDF report' },
          ].map(n => (
            <div key={n.step} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'12px', padding:'1.1rem' }}>
              <div style={{ fontSize:'0.6rem', fontWeight:800, color:'#f97316', letterSpacing:'0.1em', marginBottom:'0.5rem' }}>STEP {n.step}</div>
              <div style={{ fontSize:'1.3rem', marginBottom:'0.4rem' }}>{n.icon}</div>
              <div style={{ fontWeight:700, fontSize:'0.88rem', color:'#0f1218', marginBottom:'0.3rem' }}>{n.title}</div>
              <div style={{ fontSize:'0.75rem', color:'#8892a4', lineHeight:1.5 }}>{n.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
