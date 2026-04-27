import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';

const logColor = { info:'#8892a4', success:'#16a34a', error:'#dc2626', warn:'#d97706' };
const logBg    = { info:'transparent', success:'#f0fdf4', error:'#fef2f2', warn:'#fffbeb' };
const S = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

export default function TCPLive() {
  const [devices, setDevices] = useState([]);
  const [states,  setStates]  = useState({});
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const load = async () => {
    try {
      const [d,s,r] = await Promise.all([api.getDevices(), api.getAllStates(), api.getResults()]);
      setDevices(d); setStates(s); setResults(r.slice(0,8));
    } catch(e){}
  };

  useEffect(() => { load(); pollRef.current=setInterval(load,2000); return ()=>clearInterval(pollRef.current); },[]);

  const connectAll    = async () => { setLoading(true); await api.connectAll(10); setLoading(false); };
  const disconnectAll = async () => { await api.disconnectAll(); load(); };

  const connCount  = devices.filter(d=>d.tcp_connected).length;
  const runCount   = devices.filter(d=>d.tcp_running).length;
  const totalRes   = Object.values(states).reduce((a,s)=>a+(s.total||0),0);
  const allLogs    = Object.entries(states)
    .flatMap(([did,s])=>(s.logs||[]).map(l=>({...l,dname:devices.find(d=>d.id===parseInt(did))?.name||`Dev ${did}`})))
    .sort((a,b)=>a.time>b.time?1:-1).slice(-40);

  return (
    <div>
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.2)', color:'#3b82f6', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Phase 2</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Live Connect</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>Monitor all machine connections simultaneously</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          { label:'Total Devices', value:devices.length, icon:'🔬', top:'linear-gradient(90deg,#f97316,#fbbf24)', bg:'rgba(249,115,22,0.08)' },
          { label:'Connected',     value:connCount,       icon:'🟢', top:'linear-gradient(90deg,#22c55e,#84cc16)', bg:'rgba(34,197,94,0.08)' },
          { label:'Running',       value:runCount,        icon:'🔵', top:'linear-gradient(90deg,#3b82f6,#06b6d4)', bg:'rgba(59,130,246,0.08)' },
          { label:'Auto-Received', value:totalRes,        icon:'📊', top:'linear-gradient(90deg,#a855f7,#ec4899)', bg:'rgba(168,85,247,0.08)' },
        ].map(s=>(
          <div key={s.label} style={{ ...S.card, padding:'1.2rem', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:s.top }}></div>
            <div style={{ width:'36px', height:'36px', background:s.bg, borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', marginBottom:'0.7rem' }}>{s.icon}</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.8rem', color:'#0f1218' }}>{s.value}</div>
            <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.15rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.card, padding:'1.3rem', marginBottom:'1.5rem', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'1rem' }}>
        <div>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', fontSize:'0.95rem' }}>Connect All Devices Simultaneously</div>
          <div style={{ fontSize:'0.78rem', color:'#8892a4', marginTop:'0.15rem' }}>Connects to all {devices.length} devices at once — exactly like LiveHealth</div>
        </div>
        <div style={{ display:'flex', gap:'0.6rem' }}>
          <button onClick={connectAll} disabled={loading} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.88rem', boxShadow:'0 4px 14px rgba(249,115,22,0.3)', opacity:loading?0.7:1 }}>
            {loading?'⏳ Connecting...':'🔌 Connect All'}
          </button>
          <button onClick={disconnectAll} style={{ background:'#fff1f0', color:'#dc2626', border:'1px solid #fecaca', borderRadius:'10px', padding:'0.7rem 1.1rem', fontWeight:600, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>⏹ Stop All</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ padding:'1rem 1.3rem', borderBottom:'1px solid #e8ecf4', fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', fontSize:'0.9rem' }}>Device Status</div>
          {devices.map(d=>{
            const st=states[d.id]||{};
            return (
              <div key={d.id} style={{ padding:'0.75rem 1.3rem', borderBottom:'1px solid #f4f6fa', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
                  <div style={{ width:'9px', height:'9px', borderRadius:'50%', background:d.tcp_connected?'#f97316':d.tcp_running?'#fbbf24':'#d1d5db', boxShadow:d.tcp_connected?'0 0 8px rgba(249,115,22,0.6)':'', flexShrink:0 }}></div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:'0.85rem', color:'#0f1218' }}>{d.name}</div>
                    <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>{d.device_type} · {d.ip_address}:{d.port}</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                  <span style={{ fontSize:'0.65rem', fontWeight:700, padding:'0.18rem 0.55rem', borderRadius:'4px', background:d.tcp_connected?'rgba(249,115,22,0.1)':d.tcp_running?'#eff6ff':'#f4f6fa', color:d.tcp_connected?'#f97316':d.tcp_running?'#2563eb':'#8892a4', border:`1px solid ${d.tcp_connected?'rgba(249,115,22,0.2)':d.tcp_running?'#bfdbfe':'#e8ecf4'}` }}>
                    {d.tcp_connected?'Connected':d.tcp_running?'Connecting...':'Offline'}
                  </span>
                  <span style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#f97316', fontSize:'0.9rem' }}>{st.total||0}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ ...S.card, padding:'1.3rem' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', fontSize:'0.9rem', marginBottom:'0.8rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            📡 Combined Live Log
            <span style={{ fontSize:'0.58rem', background:'rgba(249,115,22,0.1)', color:'#f97316', padding:'0.15rem 0.5rem', borderRadius:'4px', fontWeight:700, border:'1px solid rgba(249,115,22,0.2)' }}>AUTO REFRESH</span>
          </div>
          <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.7rem', height:'280px', overflowY:'auto', fontFamily:'monospace', fontSize:'0.7rem' }}>
            {allLogs.length===0
              ? <div style={{ color:'#8892a4', textAlign:'center', paddingTop:'4rem' }}>Connect devices to see live activity...</div>
              : allLogs.map((l,i)=>(
                <div key={i} style={{ background:logBg[l.level]||'transparent', borderLeft:`3px solid ${logColor[l.level]||'#e8ecf4'}`, padding:'0.22rem 0.5rem', marginBottom:'0.18rem', borderRadius:'0 3px 3px 0' }}>
                  <span style={{ color:'#8892a4', marginRight:'0.4rem' }}>[{l.time}]</span>
                  <span style={{ color:'#f97316', fontWeight:700, marginRight:'0.3rem' }}>[{l.dname}]</span>
                  <span style={{ color:logColor[l.level]||'#0f1218' }}>{l.msg}</span>
                </div>
              ))
            }
          </div>
        </div>

        <div style={{ ...S.card, padding:'1.3rem', gridColumn:'1/-1' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', fontSize:'0.9rem', marginBottom:'0.8rem' }}>⚡ Auto-Received Results <span style={{ fontSize:'0.72rem', fontWeight:400, color:'#8892a4' }}>— No manual action needed</span></div>
          {results.length===0
            ? <div style={{ textAlign:'center', color:'#8892a4', padding:'1.5rem', fontSize:'0.85rem' }}>Results will appear automatically when machines send data</div>
            : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'0.6rem' }}>
                {results.map(r=>(
                  <div key={r.id} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.7rem 0.9rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:'0.85rem', color:'#0f1218' }}>{r.patient_name}</div>
                      <div style={{ fontSize:'0.7rem', color:'#8892a4', marginTop:'0.1rem' }}><span style={{ color:'#f97316', fontWeight:700 }}>{r.barcode}</span></div>
                    </div>
                    <span style={{ fontSize:'0.62rem', background:'rgba(249,115,22,0.1)', color:'#f97316', padding:'0.15rem 0.5rem', borderRadius:'4px', fontWeight:700, border:'1px solid rgba(249,115,22,0.2)' }}>AUTO ✓</span>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
    </div>
  );
}
