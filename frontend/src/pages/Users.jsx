import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

// roles a lab_admin can create (super/lab admin excluded by backend anyway)
const ROLE_OPTIONS = [
  { value:'pathologist',  label:'Doctor (Pathologist)' },
  { value:'technician',   label:'Staff — Technician' },
  { value:'receptionist', label:'Staff — Receptionist' },
  { value:'phlebotomist', label:'Staff — Phlebotomist' },
  { value:'franchise',    label:'Organization login' },
];
const roleLabel = (r) => ROLE_OPTIONS.find(o=>o.value===r)?.label || r;
const roleColor = { pathologist:'#16a34a', technician:'#2563eb', receptionist:'#8b5cf6', phlebotomist:'#0ea5e9', franchise:'#f97316', lab_admin:'#dc2626', super_admin:'#dc2626', patient:'#64748b' };

const BLANK = { full_name:'', email:'', password:'', role:'technician', franchise_id:'', branch_id:'', department_id:'', phone:'' };

export default function Users() {
  const [users, setUsers]       = useState([]);
  const [orgs, setOrgs]         = useState([]);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast]       = useState(null);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  const load = () => authedFetch('/admin/users').then(r=>r.ok?r.json():[]).then(setUsers).catch(()=>{});
  useEffect(() => {
    load();
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
    authedFetch('/catalog/departments').then(r=>r.ok?r.json():[]).then(setDepartments).catch(()=>{});
  }, []);

  const orgName = (id) => orgs.find(o=>o.id===id)?.name || '—';

  const openCreate = () => { setEditingId(null); setForm(BLANK); setShowForm(true); };
  const startEdit = (u) => {
    setEditingId(u.id);
    setForm({ full_name:u.full_name||'', email:u.email||'', password:'', role:u.role,
              franchise_id:u.franchise_id ?? '', branch_id:u.branch_id ?? '', department_id:u.department_id ?? '', phone:u.phone||'' });
    setShowForm(true);
    window.scrollTo({ top:0, behavior:'smooth' });
  };

  const doDelete = async () => {
    const u = confirmDel; if (!u) return;
    try {
      const res = await authedFetch(`/admin/users/${u.id}`, { method:'DELETE' });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      setConfirmDel(null); load(); showToast('success', `Deleted ${u.full_name||u.email}`);
    } catch (e) { setConfirmDel(null); showToast('error', String(e.message||'Delete failed')); }
  };

  const submit = async () => {
    if (!form.full_name.trim()) return showToast('error', 'Name required');
    if (!editingId && !form.email.trim())     return showToast('error', 'Email (login id) required');
    if (!editingId && !form.password.trim())  return showToast('error', 'Password required');
    if (form.role==='franchise' && !form.franchise_id) return showToast('error', 'Pick which organization this login belongs to');
    setSaving(true);
    try {
      if (editingId) {
        const payload = {
          full_name: form.full_name.trim(), role: form.role,
          phone: form.phone || null,
          franchise_id: form.franchise_id ? parseInt(form.franchise_id) : null,
          branch_id: form.branch_id ? parseInt(form.branch_id) : null,
          department_id: form.department_id ? parseInt(form.department_id) : null,
        };
        if (form.password.trim()) payload.password = form.password;  // optional reset
        const res = await authedFetch(`/admin/users/${editingId}`, { method:'PUT',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
        showToast('success', `Updated ${payload.full_name}`);
      } else {
        const payload = {
          full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(),
          password: form.password, role: form.role,
          phone: form.phone || null,
          franchise_id: form.franchise_id ? parseInt(form.franchise_id) : null,
          branch_id: form.branch_id ? parseInt(form.branch_id) : null,
          department_id: form.department_id ? parseInt(form.department_id) : null,
        };
        const res = await authedFetch('/admin/users', { method:'POST',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
        showToast('success', `Created ${payload.full_name}`);
      }
      setForm(BLANK); setEditingId(null); setShowForm(false); load();
    } catch (e) { showToast('error', String(e.message||'Save failed')); }
    setSaving(false);
  };

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}`, animation:'toastIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='success'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)' }}>{toast.kind==='success'?'✓':'✕'}</div>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(40px);} to { opacity:1; transform:translateX(0);} }`}</style>

      {confirmDel && (
        <div onClick={()=>setConfirmDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ width:'48px', height:'48px', borderRadius:'12px', background:'rgba(220,38,38,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem', marginBottom:'1rem' }}>🗑️</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this user?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem', lineHeight:1.5 }}>
              <strong style={{ color:'#0f1218' }}>{confirmDel.full_name || confirmDel.email}</strong> will lose access (login deactivated). Their past activity stays in the audit log.
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setConfirmDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Access</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Users &amp; Staff</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{users.length} logins · doctors, staff &amp; organization access</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
          + Add User
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem' }}>{editingId ? 'Edit User' : 'New User / Login'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Full Name *</label><input style={inp} placeholder="Dr. A. Sharma" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} /></div>
            <div><label style={lbl}>Role *</label>
              <select style={inp} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></div>
            <div><label style={lbl}>Email (login id) {editingId ? '' : '*'}</label>
              <input style={{ ...inp, ...(editingId ? { background:'#f1f3f7', color:'#8892a4' } : {}) }} type="email" placeholder="doctor@lab.com" value={form.email} disabled={!!editingId} onChange={e=>setForm({...form,email:e.target.value})} /></div>
            <div><label style={lbl}>Password {editingId ? <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(leave blank to keep)</span> : '*'}</label>
              <input style={inp} type="text" placeholder={editingId ? '••••••' : 'set a password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></div>
            <div><label style={lbl}>Phone <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(for WhatsApp)</span></label>
              <input style={inp} placeholder="10-digit mobile" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
            {form.role === 'franchise' && (
              <div><label style={lbl}>Organization *</label>
                <select style={inp} value={form.franchise_id} onChange={e=>setForm({...form,franchise_id:e.target.value})}>
                  <option value="">— Select organization —</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></div>
            )}
            {(form.role === 'technician' || form.role === 'receptionist' || form.role === 'phlebotomist') && (
              <div><label style={lbl}>Branch <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(optional)</span></label>
                <select style={inp} value={form.branch_id} onChange={e=>setForm({...form,branch_id:e.target.value})}>
                  <option value="">— Any / main —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            )}
            <div><label style={lbl}>Department <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(optional)</span></label>
              <select style={inp} value={form.department_id} onChange={e=>setForm({...form,department_id:e.target.value})}>
                <option value="">— Unassigned —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></div>
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
              {saving ? 'Saving…' : editingId ? 'Update User' : 'Create User'}
            </button>
            <button onClick={()=>{ setShowForm(false); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Name','Login (email)','Phone','Role','Department','Organization','Status','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No users yet.</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.86rem' }}>{u.full_name || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.83rem', fontFamily:'monospace' }}>{u.email}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.83rem' }}>{u.phone || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:(roleColor[u.role]||'#64748b')+'18', color:roleColor[u.role]||'#64748b', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>{roleLabel(u.role)}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.83rem' }}>{departments.find(d=>d.id===u.department_id)?.name || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.83rem' }}>{u.franchise_id ? orgName(u.franchise_id) : '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ color: u.is_active===false ? '#dc2626' : '#16a34a', fontSize:'0.78rem', fontWeight:700 }}>{u.is_active===false ? 'Inactive' : 'Active'}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(u)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setConfirmDel(u)} style={iconBtn('#dc2626')} disabled={u.role==='lab_admin'||u.role==='super_admin'}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}
