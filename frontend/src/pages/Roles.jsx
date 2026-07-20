import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.5rem 0.7rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.83rem', outline:'none', width:'100%' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

export default function Roles() {
  const [roles, setRoles]     = useState([]);
  const [edits, setEdits]     = useState({});   // {role_key: {label, is_active}} draft changes
  const [saving, setSaving]   = useState(null);
  const [toast, setToast]     = useState(null);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3000); };

  const load = () => authedFetch('/admin/roles?active_only=false').then(r=>r.ok?r.json():[]).then(setRoles).catch(()=>{});
  useEffect(() => { load(); }, []);

  const draft = (r) => edits[r.role_key] || { label: r.label, is_active: r.is_active };
  const setDraft = (key, patch) => setEdits(prev => ({ ...prev, [key]: { ...draft(roles.find(r=>r.role_key===key)), ...prev[key], ...patch } }));

  const save = async (r) => {
    const d = draft(r);
    setSaving(r.role_key);
    try {
      const res = await authedFetch(`/admin/roles/${r.role_key}`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ label: d.label, is_active: d.is_active }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'Save failed'); }
      showToast('success', `Updated ${d.label}`);
      setEdits(prev => { const n = { ...prev }; delete n[r.role_key]; return n; });
      load();
    } catch (e) { showToast('error', String(e.message||'Save failed')); }
    setSaving(null);
  };

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}` }}>
          <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Roles</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem', maxWidth:'640px' }}>
          Rename how each role appears across the app (Users &amp; Staff, Menu Permissions, …) — every page pulls this list dynamically instead of hardcoding it.
          The underlying role isn't editable here: it's what the backend uses to decide what someone is allowed to do, so it stays fixed. Deactivating a role hides it from new-user pickers without affecting existing logins.
        </p>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Role Key','Display Label','Active','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map(r => {
              const d = draft(r);
              const dirty = edits[r.role_key] != null;
              return (
                <tr key={r.role_key} style={{ borderBottom:'1px solid #f4f6fa' }}>
                  <td style={{ padding:'0.8rem 1.3rem', fontFamily:'monospace', color:'#8892a4', fontSize:'0.8rem' }}>{r.role_key}</td>
                  <td style={{ padding:'0.6rem 1.3rem' }}>
                    <input style={inp} value={d.label} onChange={e=>setDraft(r.role_key, { label: e.target.value })} />
                  </td>
                  <td style={{ padding:'0.8rem 1.3rem' }}>
                    <input type="checkbox" checked={d.is_active} disabled={r.role_key==='super_admin'}
                      onChange={e=>setDraft(r.role_key, { is_active: e.target.checked })}
                      style={{ width:'17px', height:'17px', accentColor:'#16a34a', cursor:'pointer' }} />
                  </td>
                  <td style={{ padding:'0.8rem 1.3rem' }}>
                    <button onClick={()=>save(r)} disabled={!dirty || saving===r.role_key}
                      style={{ background: dirty ? 'linear-gradient(135deg,#f97316,#fbbf24)' : '#f1f3f7', color: dirty ? '#fff' : '#c4cad6', border:'none', borderRadius:'8px', padding:'0.45rem 1rem', fontWeight:700, cursor: dirty?'pointer':'default', fontSize:'0.78rem', fontFamily:'Manrope,sans-serif' }}>
                      {saving===r.role_key ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
