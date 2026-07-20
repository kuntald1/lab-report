import { useEffect, useState, Fragment } from 'react';
import { authedFetch } from '../services/auth';

const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

// Mirrors the Sidebar's nav[] list — kept as a static reference here so this page
// doesn't need to import the component. If a menu item is added to Sidebar.jsx,
// add its id/label here too so it becomes configurable.
const MENU_ITEMS = [
  { id:'dashboard', label:'Dashboard', group:'Main Menu' },
  { id:'devices', label:'Your Devices', group:'Main Menu' },
  { id:'patients', label:'Patients', group:'Main Menu' },
  { id:'status', label:'Change Status', group:'Main Menu' },
  { id:'results', label:'Results', group:'Main Menu' },
  { id:'tat', label:'TAT Report', group:'Main Menu' },
  { id:'tubes', label:'Sample Tubes', group:'Master' },
  { id:'departments', label:'Departments', group:'Master' },
  { id:'orggroups', label:'Org Groups', group:'Master' },
  { id:'organizations', label:'Organizations', group:'Master' },
  { id:'branches', label:'Branches', group:'Master' },
  { id:'pricing', label:'Group / Org Pricing', group:'Master' },
  { id:'testscatalog', label:'Tests Catalog', group:'Master' },
  { id:'users', label:'Users & Staff', group:'Master' },
  { id:'roles', label:'Roles', group:'Master' },
  { id:'menupermissions', label:'Menu Permissions', group:'Master' },
  { id:'billing', label:'New Bill', group:'Master' },
  { id:'bills', label:'Bills', group:'Master' },
  { id:'doctors', label:'Doctor Commission', group:'Master' },
  { id:'credit', label:'Manage Credit', group:'Master' },
  { id:'simulator', label:'Simulator', group:'Tools' },
  { id:'tcp', label:'Live Connect', group:'Tools' },
  { id:'reportvalidate', label:'Report Validate', group:'Reports (Doctor)' },
  { id:'validatehistory', label:'Validate History', group:'Reports (Doctor)' },
  { id:'mycommission', label:'My Commission', group:'Reports (Doctor)' },
  { id:'historyneeded', label:'History Needed', group:'Reports (Lab)' },
  { id:'samplereport', label:'Sample Report', group:'Reports (Lab)' },
];
const GROUPS = [...new Set(MENU_ITEMS.map(m=>m.group))];

// roles configurable here (must match backend's CONFIGURABLE_ROLES) — fetched from the
// dynamic Roles master list instead of hardcoded, so a relabel there shows up here too.
const CONFIGURABLE_ROLE_KEYS = ['pathologist','technician','receptionist','phlebotomist','franchise'];

export default function MenuPermissions() {
  const [config, setConfig] = useState(null);   // {role: [hidden_key,...]}
  const [roleDefs, setRoleDefs] = useState(null); // [{role_key,label},...] from the dynamic Roles master list
  const [saving, setSaving] = useState(null);    // role currently saving
  const [toast, setToast]   = useState(null);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3000); };

  const load = () => {
    authedFetch('/admin/menu-config').then(r=>r.ok?r.json():{}).then(setConfig).catch(()=>setConfig({}));
    authedFetch('/admin/roles').then(r=>r.ok?r.json():[]).then(setRoleDefs).catch(()=>setRoleDefs([]));
  };
  useEffect(() => { load(); }, []);

  const ROLES = (roleDefs || [])
    .filter(r => CONFIGURABLE_ROLE_KEYS.includes(r.role_key))
    .map(r => ({ value: r.role_key, label: r.label }));

  const isHidden = (role, id) => (config?.[role] || []).includes(id);
  const toggle = (role, id) => {
    setConfig(prev => {
      const cur = prev[role] || [];
      const next = cur.includes(id) ? cur.filter(k=>k!==id) : [...cur, id];
      return { ...prev, [role]: next };
    });
  };

  // group-level: are ALL items in this group currently visible for this role?
  const groupAllVisible = (role, group) => {
    const ids = MENU_ITEMS.filter(m=>m.group===group).map(m=>m.id);
    const hiddenSet = new Set(config?.[role] || []);
    return ids.every(id => !hiddenSet.has(id));
  };
  const toggleGroup = (role, group) => {
    const ids = MENU_ITEMS.filter(m=>m.group===group).map(m=>m.id);
    const allVisible = groupAllVisible(role, group);
    setConfig(prev => {
      const cur = new Set(prev[role] || []);
      ids.forEach(id => { if (allVisible) cur.add(id); else cur.delete(id); });   // all visible -> hide all; else -> show all
      return { ...prev, [role]: [...cur] };
    });
  };

  const saveRole = async (role) => {
    setSaving(role);
    try {
      const res = await authedFetch(`/admin/menu-config/${role}`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ hidden_keys: config[role] || [] }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'Save failed'); }
      showToast('success', `Saved menu for ${ROLES.find(r=>r.value===role)?.label || role}`);
    } catch (e) { showToast('error', String(e.message||'Save failed')); }
    setSaving(null);
  };

  if (config === null || roleDefs === null) return <div style={{ color:'#8892a4', padding:'2rem' }}>Loading…</div>;

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}` }}>
          <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Menu Permissions</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>
          Choose which sidebar items each role can see. Super Admin and Lab Admin always see everything — they aren't shown here because they can't be restricted.
        </p>
      </div>

      <div style={{ display:'flex', gap:'0.6rem', marginBottom:'1.5rem', flexWrap:'wrap' }}>
        {ROLES.map(r => (
          <button key={r.value} onClick={()=>saveRole(r.value)} disabled={saving===r.value}
            style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.5rem 1.1rem', fontWeight:700, cursor:'pointer', fontSize:'0.78rem', fontFamily:'Manrope,sans-serif' }}>
            {saving===r.value ? 'Saving…' : `Save ${r.label}`}
          </button>
        ))}
      </div>

      <div style={{ ...S.card, padding:0, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              <th style={{ textAlign:'left', padding:'0.8rem 1.2rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', position:'sticky', left:0, background:'#fafbfc' }}>Menu Item</th>
              {ROLES.map(r => (
                <th key={r.value} style={{ textAlign:'center', padding:'0.8rem 1rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{r.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(group => (
              <Fragment key={group}>
                <tr>
                  <td style={{ padding:'0.6rem 1.2rem 0.3rem', fontSize:'0.62rem', fontWeight:800, color:'#c2410c', textTransform:'uppercase', letterSpacing:'0.07em', background:'rgba(249,115,22,0.04)', position:'sticky', left:0 }}>{group}</td>
                  {ROLES.map(r => (
                    <td key={r.value} style={{ textAlign:'center', padding:'0.3rem 1rem', background:'rgba(249,115,22,0.04)' }}>
                      <input type="checkbox" title={`Toggle all "${group}" items for ${r.label}`} checked={groupAllVisible(r.value, group)} onChange={()=>toggleGroup(r.value, group)}
                        style={{ width:'15px', height:'15px', accentColor:'#f97316', cursor:'pointer' }} />
                    </td>
                  ))}
                </tr>
                {MENU_ITEMS.filter(m=>m.group===group).map(m => (
                  <tr key={m.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                    <td style={{ padding:'0.6rem 1.2rem', fontWeight:600, color:'#0f1218', position:'sticky', left:0, background:'#fff' }}>{m.label}</td>
                    {ROLES.map(r => (
                      <td key={r.value} style={{ textAlign:'center', padding:'0.6rem 1rem' }}>
                        <input type="checkbox" checked={!isHidden(r.value, m.id)} onChange={()=>toggle(r.value, m.id)}
                          style={{ width:'17px', height:'17px', accentColor:'#16a34a', cursor:'pointer' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
