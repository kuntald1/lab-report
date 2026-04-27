import { useState } from 'react';

const nav = [
  { id:'dashboard', icon:'⬡',  label:'Dashboard',    section:'main' },
  { id:'devices',   icon:'🔬', label:'Your Devices',  section:'main', badge:'devices' },
  { id:'patients',  icon:'👤', label:'Patients',      section:'main', badge:'patients' },
  { id:'results',   icon:'🧪', label:'Results',       section:'main', badge:'results' },
  { id:'simulator', icon:'⚡', label:'Simulator',     section:'tools', tag:'DEMO' },
  { id:'tcp',       icon:'🔌', label:'Live Connect',  section:'tools', tag:'PHASE 2' },
];

export default function Sidebar({ current, onChange, counts = {} }) {
  const s = {
    aside: { position:'fixed', top:0, left:0, bottom:0, width:'235px', background:'#1a1f2e', display:'flex', flexDirection:'column', zIndex:50, boxShadow:'4px 0 24px rgba(0,0,0,0.15)' },
    logoWrap: { padding:'1.4rem 1.3rem 1.2rem', borderBottom:'1px solid rgba(255,255,255,0.06)' },
    logoRow: { display:'flex', alignItems:'center', gap:'0.7rem' },
    logoIcon: { width:'38px', height:'38px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'11px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.15rem', boxShadow:'0 4px 16px rgba(249,115,22,0.4)', flexShrink:0 },
    logoText: { fontFamily:'Manrope,sans-serif', fontSize:'1.05rem', fontWeight:800, color:'#fff', letterSpacing:'-0.01em' },
    logoSub: { fontSize:'0.6rem', color:'rgba(255,255,255,0.28)', marginTop:'0.1rem', letterSpacing:'0.04em' },
    pill: { margin:'0.9rem 1rem', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', borderRadius:'8px', padding:'0.45rem 0.8rem', display:'flex', alignItems:'center', gap:'0.5rem' },
    pillDot: { width:'7px', height:'7px', borderRadius:'50%', background:'#f97316', boxShadow:'0 0 10px rgba(249,115,22,0.7)', flexShrink:0, animation:'pulse 2s infinite' },
    pillText: { fontSize:'0.68rem', color:'#f97316', fontWeight:700, letterSpacing:'0.04em' },
    navSection: { flex:1, padding:'0.4rem 0.6rem', overflowY:'auto' },
    navLabel: { fontSize:'0.58rem', color:'rgba(255,255,255,0.2)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', padding:'0.8rem 0.7rem 0.3rem' },
    footer: { padding:'1rem 1.3rem', borderTop:'1px solid rgba(255,255,255,0.06)' },
    userRow: { display:'flex', alignItems:'center', gap:'0.7rem' },
    avatar: { width:'34px', height:'34px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:800, color:'#fff', flexShrink:0 },
  };

  return (
    <aside style={s.aside}>
      {/* Glow effects */}
      <div style={{ position:'absolute', top:'-60px', left:'-60px', width:'200px', height:'200px', background:'radial-gradient(circle,rgba(249,115,22,0.1) 0%,transparent 70%)', pointerEvents:'none' }} />

      {/* Logo */}
      <div style={s.logoWrap}>
        <div style={s.logoRow}>
          <div style={s.logoIcon}>🔬</div>
          <div>
            <div style={s.logoText}>MediCloud</div>
            <div style={s.logoSub}>Lab Middleware v3.0</div>
          </div>
        </div>
      </div>

      {/* Online pill */}
      <div style={s.pill}>
        <div style={s.pillDot}></div>
        <span style={s.pillText}>System Online</span>
      </div>

      {/* Nav */}
      <div style={s.navSection}>
        <div style={s.navLabel}>Main Menu</div>
        {nav.filter(n=>n.section==='main').map(item => <NavItem key={item.id} item={item} active={current===item.id} onClick={()=>onChange(item.id)} count={counts[item.badge]} />)}
        <div style={s.navLabel}>Tools</div>
        {nav.filter(n=>n.section==='tools').map(item => <NavItem key={item.id} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <div style={s.userRow}>
          <div style={s.avatar}>KD</div>
          <div>
            <div style={{ fontSize:'0.8rem', fontWeight:700, color:'rgba(255,255,255,0.85)' }}>Kuntal Das</div>
            <div style={{ fontSize:'0.62rem', color:'rgba(255,255,255,0.3)', marginTop:'0.05rem' }}>Lab Administrator</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ item, active, onClick, count }) {
  const [hov, setHov] = useState(false);
  const isPhase2 = item.id === 'tcp';
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:'flex', alignItems:'center', gap:'0.65rem',
        padding:'0.58rem 0.8rem', borderRadius:'10px', cursor:'pointer',
        margin:'0.1rem 0', transition:'all 0.15s',
        background: active ? 'rgba(249,115,22,0.12)' : hov ? 'rgba(255,255,255,0.04)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.4)',
        fontWeight: active ? 700 : 500,
        borderLeft: active ? '3px solid #f97316' : '3px solid transparent',
        fontSize: '0.82rem',
      }}>
      <div style={{
        width:'26px', height:'26px', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', flexShrink:0,
        background: active ? 'linear-gradient(135deg,#f97316,#fbbf24)' : 'rgba(255,255,255,0.05)',
        boxShadow: active ? '0 2px 10px rgba(249,115,22,0.4)' : 'none',
      }}>{item.icon}</div>
      {item.label}
      {count > 0 && !item.tag && (
        <span style={{ marginLeft:'auto', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', fontSize:'0.58rem', fontWeight:800, padding:'0.15rem 0.5rem', borderRadius:'100px' }}>{count}</span>
      )}
      {item.tag && (
        <span style={{ marginLeft:'auto', fontSize:'0.52rem', fontWeight:800, padding:'0.15rem 0.45rem', borderRadius:'100px', letterSpacing:'0.04em',
          background: isPhase2 ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
          color:       isPhase2 ? '#60a5fa' : '#f97316',
          border:      isPhase2 ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(249,115,22,0.3)',
        }}>{item.tag}</span>
      )}
    </div>
  );
}
