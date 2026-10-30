import { useState, useEffect } from 'react';
import { authedFetch } from '../services/auth';
import healthycianIcon from '../assets/healthycian_icon.png';

const nav = [
  { id:'dashboard', icon:'⬡',  label:'Dashboard',    section:'main' },
  { id:'devices',   icon:'🔬', label:'Your Devices',  section:'main', badge:'devices' },
  { id:'patients',  icon:'👤', label:'Patients',      section:'main', badge:'patients' },
  { id:'status',    icon:'🔄', label:'Change Status',  section:'main' },
  { id:'results',   icon:'🧪', label:'Results',       section:'main', badge:'results' },
  { id:'tat',       icon:'⏱',  label:'TAT Report',    section:'main' },
  { id:'tubes',     icon:'🧫', label:'Sample Tubes',  section:'master' },
  { id:'departments', icon:'🏷️', label:'Departments', section:'master' },
  { id:'orggroups', icon:'🏢', label:'Org Groups',    section:'master' },
  { id:'organizations', icon:'🏥', label:'Organizations', section:'master' },
  { id:'branches', icon:'🏪', label:'Branches', section:'master' },
  { id:'pricing', icon:'💰', label:'Group / Org Pricing', section:'master' },
  { id:'testscatalog', icon:'🧾', label:'Tests Catalog', section:'master' },
  { id:'users', icon:'👥', label:'Users & Staff', section:'master' },
  { id:'menupermissions', icon:'🔐', label:'Menu Permissions', section:'master' },
  { id:'reportsettings', icon:'🖨️', label:'Report Settings', section:'master', adminOnly:true },
  { id:'billing', icon:'🧾', label:'New Bill', section:'master' },
  { id:'bills',   icon:'📑', label:'Bills',    section:'master' },
  { id:'doctors', icon:'💵', label:'Doctor Commission', section:'master' },
  { id:'reportvalidate', icon:'🩺', label:'Report Validate',  section:'reports', who:'doctor' },
  { id:'validatehistory', icon:'📋', label:'Validate History', section:'reports', who:'doctor' },
  { id:'mycommission', icon:'💰', label:'My Commission', section:'reports', who:'doctor' },
  { id:'historyneeded', icon:'📥', label:'History Needed', section:'reports', who:'lab' },
  { id:'samplereport', icon:'📊', label:'Sample Report', section:'reports', who:'lab' },
];

// Sidebar widths, exported so the page area can keep its left margin in step
// with whichever state the sidebar is in.
export const SIDEBAR_W_OPEN      = '235px';
export const SIDEBAR_W_COLLAPSED = '68px';

// The nav order, exported so App can work out which page a role should LAND on
// when the default one (Dashboard) is hidden for them.
export const NAV_ITEMS = nav;

export default function Sidebar({ current, onChange, counts = {}, user = null, onLogout = () => {}, hidden: hiddenProp = null, collapsed = false, onToggleCollapse = () => {} }) {
  const isFranchise = (user?.role || '').toLowerCase() === 'franchise';
  const isAdmin = ['super_admin','lab_admin'].includes((user?.role || '').toLowerCase());

  // role-configured hidden items (set from the Menu Permissions page). Admin roles always get [] (full menu),
  // enforced server-side too — this is a UX filter, not the security boundary.
  // App resolves this once and passes it down (it needs the same list to pick the
  // landing page); the local fetch is the fallback for any other caller.
  const [hiddenOwn, setHiddenOwn] = useState([]);
  useEffect(() => {
    if (hiddenProp !== null) return;
    if (isAdmin) { setHiddenOwn([]); return; }
    authedFetch('/admin/my-menu-hidden').then(r=>r.ok?r.json():{hidden_keys:[]}).then(d=>setHiddenOwn(d.hidden_keys||[])).catch(()=>setHiddenOwn([]));
  }, [user?.role, hiddenProp]);   // eslint-disable-line
  const hidden = hiddenProp ?? hiddenOwn;
  const visible = (items) => items.filter(n => !hidden.includes(n.id));

  const s = {
    aside: { position:'fixed', top:0, left:0, bottom:0, width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_OPEN, background:'#e6f0ee', borderRight:'1px solid #cdddd9', display:'flex', flexDirection:'column', zIndex:50, boxShadow:'2px 0 16px rgba(15,18,24,0.06)', transition:'width 0.18s ease' },
    logoWrap: { padding: collapsed ? '1.1rem 0.5rem 0.9rem' : '1.4rem 1.3rem 1.2rem', borderBottom:'1px solid #d3e2de' },
    logoRow: { display:'flex', alignItems:'center', gap:'0.7rem', justifyContent: collapsed ? 'center' : 'flex-start' },
    toggleBtn: { width:'24px', height:'24px', borderRadius:'7px', border:'1px solid #cdddd9', background:'#fff', color:'#4a625d', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:800, flexShrink:0, padding:0, lineHeight:1 },
    logoIcon: { width:'38px', height:'38px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'11px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.15rem', boxShadow:'0 4px 16px rgba(249,115,22,0.28)', flexShrink:0 },
    logoText: { fontFamily:'Manrope,sans-serif', fontSize:'1.05rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.01em' },
    logoSub: { fontSize:'0.6rem', color:'#6b8a83', marginTop:'0.1rem', letterSpacing:'0.04em' },
    pill: { margin: collapsed ? '0.9rem auto' : '0.9rem 1rem', background:'rgba(249,115,22,0.07)', border:'1px solid rgba(249,115,22,0.18)', borderRadius:'8px', padding: collapsed ? '0.45rem' : '0.45rem 0.8rem', display:'flex', alignItems:'center', justifyContent:'center', gap: collapsed ? 0 : '0.5rem' },
    pillDot: { width:'7px', height:'7px', borderRadius:'50%', background:'#f97316', boxShadow:'0 0 10px rgba(249,115,22,0.5)', flexShrink:0, animation:'pulse 2s infinite' },
    pillText: { fontSize:'0.68rem', color:'#c2410c', fontWeight:700, letterSpacing:'0.04em' },
    navSection: { flex:1, padding: collapsed ? '0.4rem 0.4rem' : '0.4rem 0.6rem', overflowY:'auto' },
    navLabel: { fontSize:'0.58rem', color:'#719089', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', padding:'0.8rem 0.7rem 0.3rem' },
    footer: { padding: collapsed ? '0.9rem 0.5rem' : '1rem 1.3rem', borderTop:'1px solid #d3e2de' },
    userRow: { display:'flex', alignItems:'center', gap:'0.7rem', flexDirection: collapsed ? 'column' : 'row' },
    avatar: { width:'34px', height:'34px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:800, color:'#fff', flexShrink:0 },
  };

  return (
    <aside style={s.aside}>
      {/* Glow effects */}
      <div style={{ position:'absolute', top:'-60px', left:'-60px', width:'200px', height:'200px', background:'radial-gradient(circle,rgba(249,115,22,0.06) 0%,transparent 70%)', pointerEvents:'none' }} />

      {/* Logo */}
      <div style={s.logoWrap}>
        <div style={s.logoRow}>
          <div style={{ ...s.logoIcon, background:'#fff', padding:'4px', boxShadow:'none', border:'1px solid #cdddd9' }}>
            <img src={healthycianIcon} alt="Healthycian" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
          </div>
          {!collapsed && (
            <div style={{ flex:1, minWidth:0 }}>
              <div style={s.logoText}>Healthycian</div>
              <div style={s.logoSub}>Lab Middleware v1.0</div>
            </div>
          )}
          {!collapsed && (
            <button type="button" onClick={onToggleCollapse} style={s.toggleBtn} title="Collapse menu" aria-label="Collapse menu">‹‹</button>
          )}
        </div>
        {collapsed && (
          <div style={{ display:'flex', justifyContent:'center', marginTop:'0.7rem' }}>
            <button type="button" onClick={onToggleCollapse} style={s.toggleBtn} title="Expand menu" aria-label="Expand menu">››</button>
          </div>
        )}
      </div>

      {/* Online pill */}
      <div style={s.pill} title={collapsed ? 'System Online' : undefined}>
        <div style={s.pillDot}></div>
        {!collapsed && <span style={s.pillText}>System Online</span>}
      </div>

      {/* Nav */}
      <div style={s.navSection}>
        {isAdmin ? (
          <>
            <SectionLabel collapsed={collapsed} style={s.navLabel}>Main Menu</SectionLabel>
            {nav.filter(n=>n.section==='main').map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} count={counts[item.badge]} />)}
            <SectionLabel collapsed={collapsed} style={s.navLabel}>Master</SectionLabel>
            {nav.filter(n=>n.section==='master').map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
            <SectionLabel collapsed={collapsed} style={s.navLabel}>Reports</SectionLabel>
            {nav.filter(n=>n.section==='reports').map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
          </>
        ) : (() => {
          const mainItems   = visible(nav.filter(n=>n.section==='main'));
          const masterItems = visible(nav.filter(n=>n.section==='master' && !n.adminOnly));
          const showCredit  = isFranchise && !hidden.includes('credit');
          const reportItems = visible(nav.filter(n=>n.section==='reports'));
          const toolItems   = visible(nav.filter(n=>n.section==='tools'));
          return (
            <>
              {mainItems.length > 0 && <SectionLabel collapsed={collapsed} style={s.navLabel}>Main Menu</SectionLabel>}
              {mainItems.map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} count={counts[item.badge]} />)}
              {(masterItems.length > 0 || showCredit) && <SectionLabel collapsed={collapsed} style={s.navLabel}>Master</SectionLabel>}
              {masterItems.map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
              {showCredit && <NavItem collapsed={collapsed} item={{ id:'credit', icon:'💳', label:'Manage Credit' }} active={current==='credit'} onClick={()=>onChange('credit')} />}
              {reportItems.length > 0 && <SectionLabel collapsed={collapsed} style={s.navLabel}>Reports</SectionLabel>}
              {reportItems.map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
              {toolItems.length > 0 && <SectionLabel collapsed={collapsed} style={s.navLabel}>Tools</SectionLabel>}
              {toolItems.map(item => <NavItem key={item.id} collapsed={collapsed} item={item} active={current===item.id} onClick={()=>onChange(item.id)} />)}
            </>
          );
        })()}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <div style={s.userRow}>
          <div style={s.avatar} title={collapsed ? (user?.full_name || user?.email || 'User') : undefined}>{initials(user)}</div>
          {!collapsed && (
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user?.full_name || user?.email || 'User'}</div>
            <div style={{ fontSize:'0.62rem', color:'#6b8a83', marginTop:'0.05rem', textTransform:'capitalize' }}>{(user?.role || 'user').replace('_',' ')}</div>
          </div>
          )}
          <div onClick={onLogout} title="Sign out"
            style={{ cursor:'pointer', color:'#84a49c', fontSize:'1rem', padding:'0.3rem', borderRadius:'7px' }}
            onMouseEnter={e=>e.currentTarget.style.color='#f97316'}
            onMouseLeave={e=>e.currentTarget.style.color='#84a49c'}>⏻</div>
        </div>
      </div>
    </aside>
  );
}

function initials(user) {
  const name = user?.full_name || user?.email || 'U';
  const parts = name.replace(/@.*/, '').split(/[ ._]/).filter(Boolean);
  return ((parts[0]?.[0] || 'U') + (parts[1]?.[0] || '')).toUpperCase();
}

// Section heading — collapsed there is no room for the word, so it becomes a
// plain rule that still separates the groups.
function SectionLabel({ collapsed, style, children }) {
  if (collapsed) return <div style={{ height:'1px', background:'#d3e2de', margin:'0.7rem 0.5rem 0.4rem' }} />;
  return <div style={style}>{children}</div>;
}

function NavItem({ item, active, onClick, count, collapsed = false }) {
  const [hov, setHov] = useState(false);
  const isPhase2 = item.id === 'tcp';
  return (
    <div onClick={onClick}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:'flex', alignItems:'center', gap: collapsed ? 0 : '0.65rem',
        justifyContent: collapsed ? 'center' : 'flex-start',
        padding: collapsed ? '0.58rem 0' : '0.58rem 0.8rem', borderRadius:'10px', cursor:'pointer',
        margin:'0.1rem 0', transition:'all 0.15s',
        background: active ? 'rgba(249,115,22,0.12)' : hov ? '#d7e8e4' : 'transparent',
        color: active ? '#0f1218' : '#4a625d',
        fontWeight: active ? 700 : 500,
        borderLeft: active ? '3px solid #f97316' : '3px solid transparent',
        fontSize: '0.82rem',
      }}>
      <div style={{
        position:'relative',
        width:'26px', height:'26px', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', flexShrink:0,
        background: active ? 'linear-gradient(135deg,#f97316,#fbbf24)' : '#d7e8e4',
        boxShadow: active ? '0 2px 10px rgba(249,115,22,0.35)' : 'none',
      }}>
        {item.icon}
        {/* collapsed: the count has nowhere to sit, so it rides on the icon */}
        {collapsed && count > 0 && (
          <span style={{ position:'absolute', top:'-4px', right:'-4px', minWidth:'15px', height:'15px', padding:'0 3px', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', fontSize:'0.52rem', fontWeight:800, borderRadius:'100px', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>{count}</span>
        )}
      </div>
      {!collapsed && item.label}
      {!collapsed && count > 0 && !item.tag && (
        <span style={{ marginLeft:'auto', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', fontSize:'0.58rem', fontWeight:800, padding:'0.15rem 0.5rem', borderRadius:'100px' }}>{count}</span>
      )}
      {!collapsed && item.tag && (
        <span style={{ marginLeft:'auto', fontSize:'0.52rem', fontWeight:800, padding:'0.15rem 0.45rem', borderRadius:'100px', letterSpacing:'0.04em',
          background: isPhase2 ? 'rgba(59,130,246,0.1)' : 'rgba(249,115,22,0.1)',
          color:       isPhase2 ? '#2563eb' : '#c2410c',
          border:      isPhase2 ? '1px solid rgba(59,130,246,0.25)' : '1px solid rgba(249,115,22,0.25)',
        }}>{item.tag}</span>
      )}
    </div>
  );
}
