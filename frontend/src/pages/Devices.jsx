import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';

const PARSERS = [
  { value:'erba_h560',  label:'Erba H560',        type:'Hematology',    port:5600  },
  { value:'xl200',      label:'XL200',             type:'Biochemistry',  port:12377 },
  { value:'sysmex',     label:'Sysmex XN330',      type:'Hematology',    port:4001  },
  { value:'erba_ec90',  label:'Erba EC 90',        type:'Hematology',    port:5600  },
  { value:'snibe',      label:'Snibe Maglumi X3',  type:'Immunology',    port:9100  },
  { value:'lifotronic', label:'Lifotronic GH-900', type:'Biochemistry',  port:7000  },
  { value:'em200',      label:'EM200 IP',          type:'Urine Analyser',port:8080  },
];
const typeIcon  = t => t==='Hematology'?'🩸':t==='Biochemistry'?'🧬':t==='Urine Analyser'?'🫧':t==='Immunology'?'🛡️':'🔬';
const typeBg    = t => t==='Hematology'?'#fff1ee':t==='Biochemistry'?'#eff6ff':t==='Urine Analyser'?'#fefce8':t==='Immunology'?'#f5f3ff':'#f0fdf4';
const typeBrd   = t => t==='Hematology'?'#fde0d8':t==='Biochemistry'?'#dbeafe':t==='Urine Analyser'?'#fde68a':t==='Immunology'?'#ddd6fe':'#bbf7d0';
const logColor  = { info:'#8892a4', success:'#16a34a', error:'#dc2626', warn:'#d97706' };
const logBg     = { info:'transparent', success:'#f0fdf4', error:'#fef2f2', warn:'#fffbeb' };
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.83rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.67rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.3rem' };

export default function Devices() {
  const [devices,  setDevices]  = useState([]);
  const [logs,     setLogs]     = useState({});
  const [showForm, setShowForm] = useState(false);
  const [loading,  setLoading]  = useState({});
  const [selDev,   setSelDev]   = useState(null);
  const pollRef = useRef(null);
  const [form, setForm] = useState({ name:'', device_type:'Hematology', ip_address:'192.168.0.112', port:'5600', parser:'erba_h560', protocol:'ASTM', bidirectional:true, is_client:false });

  const load = async () => {
    try {
      const [devs, states] = await Promise.all([api.getDevices(), api.getAllStates()]);
      setDevices(devs);
      const nl = {};
      Object.entries(states).forEach(([did,s]) => { nl[parseInt(did)] = s.logs||[]; });
      setLogs(nl);
    } catch(e){}
  };

  useEffect(() => { load(); pollRef.current = setInterval(load,2000); return ()=>clearInterval(pollRef.current); },[]);

  const handleParser = v => { const p=PARSERS.find(x=>x.value===v); if(p) setForm(f=>({...f,parser:v,device_type:p.type,port:String(p.port),name:p.label})); };
  const submit = async () => { if(!form.name) return alert('Name required'); await api.createDevice({...form,port:form.port?parseInt(form.port):null}); setShowForm(false); load(); };
  const connect    = async id => { setLoading(l=>({...l,[id]:'c'})); await api.connectDevice(id,10); setLoading(l=>({...l,[id]:null})); };
  const disconnect = async id => { setLoading(l=>({...l,[id]:'d'})); await api.disconnectDevice(id); setLoading(l=>({...l,[id]:null})); };
  const connectAll    = async () => { await api.connectAll(10); };
  const disconnectAll = async () => { await api.disconnectAll(); load(); };
  const del = async id => { if(!confirm('Delete?')) return; await api.disconnectDevice(id); await api.deleteDevice(id); if(selDev?.id===id) setSelDev(null); load(); };

  const onC = devices.filter(d=>d.tcp_connected).length;
  const onR = devices.filter(d=>d.tcp_running).length;

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem', flexWrap:'wrap', gap:'1rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.5rem' }}>Your Devices ({devices.length})</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Lab Devices</h1>
          <p style={{ color:'#8892a4', fontSize:'0.8rem', marginTop:'0.2rem' }}>{onC} connected · {onR} running · {devices.length} total</p>
        </div>
        <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap' }}>
          {devices.length > 0 && <>
            <button onClick={connectAll} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.2rem', fontWeight:700, cursor:'pointer', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>🔌 Connect All</button>
            <button onClick={disconnectAll} style={{ background:'#fff1f0', color:'#dc2626', border:'1px solid #fecaca', borderRadius:'10px', padding:'0.65rem 1rem', fontWeight:600, cursor:'pointer', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif' }}>⏹ Stop All</button>
          </>}
          <button onClick={()=>setShowForm(!showForm)} style={{ background:'#fff', color:'#0f1218', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.2rem', fontWeight:600, cursor:'pointer', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif' }}>+ Add Device</button>
        </div>
      </div>

      {showForm && (
        <div style={{ background:'#fff', border:'1px solid rgba(249,115,22,0.2)', borderRadius:'14px', padding:'1.5rem', marginBottom:'1.5rem', boxShadow:'0 4px 20px rgba(249,115,22,0.08)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1rem', fontSize:'0.95rem' }}>Add New Device</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.8rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Quick Select</label><select style={inp} value={form.parser} onChange={e=>handleParser(e.target.value)}>{PARSERS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
            <div><label style={lbl}>Device Name</label><input style={inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Erba H560" /></div>
            <div><label style={lbl}>Machine IP</label><input style={inp} value={form.ip_address} onChange={e=>setForm({...form,ip_address:e.target.value})} /></div>
            <div><label style={lbl}>Port</label><input style={inp} value={form.port} onChange={e=>setForm({...form,port:e.target.value})} /></div>
            <div><label style={lbl}>Device Type</label><input style={inp} value={form.device_type} readOnly style={{...inp,background:'#f4f6fa'}} /></div>
            <div><label style={lbl}>Connection Mode</label>
              <select style={inp} value={form.is_client?'true':'false'} onChange={e=>setForm({...form,is_client:e.target.value==='true'})}>
                <option value="false">IsClient: false — MediCloud → Machine</option>
                <option value="true">IsClient: true — Machine → MediCloud</option>
              </select>
            </div>
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 12px rgba(249,115,22,0.3)' }}>Save Device</button>
            <button onClick={()=>setShowForm(false)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:selDev?'1fr 360px':'1fr', gap:'1.5rem', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', overflow:'hidden', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'32px 260px 1fr 80px 90px 80px 190px', padding:'0.7rem 1.3rem', background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
            {['','DEVICE','IP','PORT','ISCLIENT','RESULTS','ACTIONS'].map((h,i)=>(
              <div key={i} style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', textAlign:i>=5?'center':i===1?'left':'center' }}>{h}</div>
            ))}
          </div>
          {devices.length===0 && (
            <div style={{ padding:'3rem', textAlign:'center', color:'#8892a4' }}>
              <div style={{ fontSize:'2.5rem', marginBottom:'1rem' }}>🔬</div>
              <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'0.3rem' }}>No Devices Yet</div>
              <div style={{ fontSize:'0.82rem' }}>Click "+ Add Device" to register your lab machines</div>
            </div>
          )}
          {devices.map(d=>{
            const isOn=d.tcp_connected, isRun=d.tcp_running, isSel=selDev?.id===d.id;
            const devLogs=logs[d.id]||[], lastLog=devLogs[devLogs.length-1];
            return (
              <div key={d.id} style={{ borderBottom:'1px solid #f4f6fa', background:isSel?'#fffbf7':isOn?'#fffdf9':'#fff', transition:'background 0.15s' }}>
                <div style={{ display:'grid', gridTemplateColumns:'32px 260px 1fr 80px 90px 80px 190px', padding:'0.9rem 1.3rem', alignItems:'center' }}>
                  <div style={{ display:'flex', justifyContent:'center' }}>
                    <div style={{ width:'9px', height:'9px', borderRadius:'50%', background:isOn?'#f97316':isRun?'#fbbf24':'#d1d5db', boxShadow:isOn?'0 0 8px rgba(249,115,22,0.7)':'', transition:'all 0.3s' }}></div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.7rem', minWidth:0 }}>
                    <div style={{ width:'38px', height:'38px', background:typeBg(d.device_type), border:`1.5px solid ${typeBrd(d.device_type)}`, borderRadius:'10px', display:'grid', placeItems:'center', fontSize:'1.1rem', flexShrink:0 }}>{typeIcon(d.device_type)}</div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218', fontSize:'0.88rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.name}</div>
                      <div style={{ fontSize:'0.65rem', color:'#8892a4', whiteSpace:'nowrap' }}>{d.device_type} · {d.parser||'—'}</div>
                      {lastLog && <div style={{ fontSize:'0.62rem', color:logColor[lastLog.level], marginTop:'0.1rem', fontStyle:'italic', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'200px' }}>{lastLog.msg}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <span style={{ fontFamily:'monospace', fontSize:'0.75rem', color:'#3b82f6', background:'#eff6ff', padding:'0.18rem 0.5rem', borderRadius:'4px', border:'1px solid #dbeafe' }}>{d.ip_address||'—'}</span>
                  </div>
                  <div style={{ textAlign:'center', fontFamily:'monospace', fontWeight:700, color:'#0f1218', fontSize:'0.82rem' }}>{d.port||'—'}</div>
                  <div style={{ textAlign:'center' }}>
                    <span style={{ fontSize:'0.68rem', fontWeight:700, padding:'0.18rem 0.55rem', borderRadius:'5px', background:d.is_client?'#f0fdf4':'#eff6ff', color:d.is_client?'#16a34a':'#1d4ed8', border:`1px solid ${d.is_client?'#bbf7d0':'#bfdbfe'}` }}>{d.is_client?'true':'false'}</span>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.1rem', color:(d.total_results||0)>0?'#f97316':'#d1d5db' }}>{d.total_results||0}</div>
                    {d.last_barcode && <div style={{ fontSize:'0.6rem', color:'#8892a4' }}>{d.last_barcode}</div>}
                  </div>
                  <div style={{ display:'flex', gap:'0.35rem', justifyContent:'flex-end' }}>
                    {!isRun
                      ? <button onClick={()=>connect(d.id)} disabled={!!loading[d.id]} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'6px', padding:'0.32rem 0.8rem', cursor:'pointer', fontSize:'0.72rem', fontWeight:700, fontFamily:'Manrope,sans-serif', opacity:loading[d.id]?0.6:1, whiteSpace:'nowrap', boxShadow:'0 2px 8px rgba(249,115,22,0.3)' }}>{loading[d.id]==='c'?'...':'Connect'}</button>
                      : <button onClick={()=>disconnect(d.id)} style={{ background:'#fff1f0', color:'#dc2626', border:'1px solid #fecaca', borderRadius:'6px', padding:'0.32rem 0.8rem', cursor:'pointer', fontSize:'0.72rem', fontWeight:700, fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>Disconnect</button>
                    }
                    <button onClick={()=>setSelDev(isSel?null:d)} style={{ background:isSel?'rgba(249,115,22,0.1)':'#fafbfc', color:isSel?'#f97316':'#8892a4', border:`1px solid ${isSel?'rgba(249,115,22,0.3)':'#e8ecf4'}`, borderRadius:'6px', padding:'0.32rem 0.7rem', cursor:'pointer', fontSize:'0.72rem', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Logs</button>
                    <button onClick={()=>del(d.id)} style={{ background:'transparent', color:'#dc2626', border:'1px solid #fecaca', borderRadius:'6px', padding:'0.32rem 0.55rem', cursor:'pointer', fontSize:'0.78rem' }}>✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selDev && (
          <div style={{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.2rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)', position:'sticky', top:'5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.8rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:selDev.tcp_connected?'#f97316':selDev.tcp_running?'#fbbf24':'#d1d5db', boxShadow:selDev.tcp_connected?'0 0 8px rgba(249,115,22,0.6)':'' }}></div>
                <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', fontSize:'0.9rem' }}>{selDev.name}</div>
              </div>
              <button onClick={()=>setSelDev(null)} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'6px', padding:'0.25rem 0.6rem', cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem', marginBottom:'0.8rem' }}>
              {[
                { label:'Status',   value:selDev.tcp_connected?'Connected':selDev.tcp_running?'Connecting...':'Offline', color:selDev.tcp_connected?'#f97316':selDev.tcp_running?'#2563eb':'#8892a4' },
                { label:'Results',  value:selDev.total_results||0, color:'#0f1218' },
                { label:'IP:Port',  value:`${selDev.ip_address}:${selDev.port}`, color:'#0f1218' },
                { label:'IsClient', value:selDev.is_client?'true':'false', color:selDev.is_client?'#16a34a':'#1d4ed8' },
              ].map(x=>(
                <div key={x.label} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'7px', padding:'0.45rem 0.7rem' }}>
                  <div style={{ fontSize:'0.6rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', marginBottom:'0.15rem' }}>{x.label}</div>
                  <div style={{ fontWeight:700, color:x.color, fontSize:'0.8rem' }}>{x.value}</div>
                </div>
              ))}
            </div>
            <div style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.7rem', height:'320px', overflowY:'auto', fontFamily:'monospace', fontSize:'0.7rem' }}
              ref={el=>{ if(el) el.scrollTop=el.scrollHeight; }}>
              {(logs[selDev.id]||[]).length===0
                ? <div style={{ color:'#8892a4', textAlign:'center', paddingTop:'4rem', lineHeight:1.8 }}>No activity yet.<br/>Click <strong>Connect</strong> to start.</div>
                : (logs[selDev.id]||[]).map((l,i)=>(
                  <div key={i} style={{ background:logBg[l.level]||'transparent', borderLeft:`3px solid ${logColor[l.level]||'#e8ecf4'}`, padding:'0.22rem 0.5rem', marginBottom:'0.18rem', borderRadius:'0 3px 3px 0' }}>
                    <span style={{ color:'#8892a4', marginRight:'0.4rem' }}>[{l.time}]</span>
                    <span style={{ color:logColor[l.level]||'#0f1218' }}>{l.msg}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
