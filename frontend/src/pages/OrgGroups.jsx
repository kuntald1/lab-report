import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

export default function OrgGroups() {
  const [groups, setGroups]     = useState([]);
  const [orgs, setOrgs]         = useState([]);   // to show member count per group
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName]         = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast]       = useState(null);
  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3000); };

  const load = () => {
    authedFetch('/b2b/org-groups').then(r=>r.ok?r.json():[]).then(setGroups).catch(()=>{});
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
  };
  useEffect(() => { load(); }, []);

  const memberCount = (groupId) => orgs.filter(o => o.org_group_id === groupId).length;

  const doDelete = async () => {
    const g = confirmDel; if (!g) return;
    if (memberCount(g.id) > 0) { setConfirmDel(null); showToast('error', 'Move its organizations out first'); return; }
    try {
      const res = await authedFetch(`/b2b/org-groups/${g.id}`, { method:'DELETE' });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      setConfirmDel(null); load(); showToast('success', `Deleted ${g.name}`);
    } catch (e) { setConfirmDel(null); showToast('error', String(e.message||'Delete failed')); }
  };

  const openCreate = () => { setEditingId(null); setName(''); setShowForm(true); };
  const startEdit  = (g) => { setEditingId(g.id); setName(g.name || ''); setShowForm(true); };

  const submit = async () => {
    if (!name.trim()) return alert('Group name required');
    setSaving(true);
    try {
      const url = editingId ? `/b2b/org-groups/${editingId}` : '/b2b/org-groups';
      await authedFetch(url, { method: editingId ? 'PUT' : 'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: name.trim() }) });
      setName(''); setEditingId(null); setShowForm(false); load();
    } catch { alert('Save failed'); }
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
      {confirmDel && (
        <div onClick={()=>setConfirmDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ width:'48px', height:'48px', borderRadius:'12px', background:'rgba(220,38,38,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem', marginBottom:'1rem' }}>🗑️</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this group?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem', lineHeight:1.5 }}>
              <strong style={{ color:'#0f1218' }}>{confirmDel.name}</strong> will be removed. Its saved group pricing is cleared. Organizations must be moved out of the group first.
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setConfirmDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(40px);} to { opacity:1; transform:translateX(0);} }`}</style>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Organization Groups</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{groups.length} groups · e.g. B2B, Rural, Golden</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
          + Add Group
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem' }}>
            {editingId ? 'Edit Group' : 'New Organization Group'}
          </div>
          <div style={{ maxWidth:'420px', marginBottom:'1rem' }}>
            <label style={lbl}>Group Name *</label>
            <input style={inp} placeholder="e.g. B2B" value={name} onChange={e=>setName(e.target.value)}
                   onKeyDown={e=>{ if(e.key==='Enter') submit(); }} />
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
              {saving ? 'Saving...' : editingId ? 'Update Group' : 'Add Group'}
            </button>
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setName(''); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Group Name','Organizations','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No groups yet. Create B2B, Rural, Golden…</td></tr>
            )}
            {groups.map(g => (
              <tr key={g.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{g.name}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>
                    {memberCount(g.id)} org{memberCount(g.id)===1?'':'s'}
                  </span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(g)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setConfirmDel(g)} style={iconBtn('#dc2626')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color:'#8892a4', fontSize:'0.75rem', marginTop:'1rem' }}>
        Tip: assign which tests &amp; prices belong to a group on the upcoming <strong>Group Pricing</strong> screen, and put organizations into a group from the <strong>Organizations</strong> screen.
      </p>
    </div>
  );
}

function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}
