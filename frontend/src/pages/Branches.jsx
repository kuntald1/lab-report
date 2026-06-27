import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const BLANK = { name:'', code:'', address:'', is_main:false };

export default function Branches() {
  const [branches, setBranches] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]         = useState(BLANK);

  const load = () => authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditingId(null); setForm(BLANK); setShowForm(true); };
  const startEdit  = (b) => {
    setEditingId(b.id);
    setForm({ name:b.name||'', code:b.code||'', address:b.address||'', is_main:!!b.is_main });
    setShowForm(true);
    window.scrollTo({ top:0, behavior:'smooth' });
  };

  const submit = async () => {
    if (!form.name) return alert('Branch name required');
    setSaving(true);
    try {
      if (editingId) {
        await authedFetch(`/admin/branches/${editingId}`, { method:'PUT',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
      } else {
        await authedFetch('/admin/branches', { method:'POST',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
      }
      setForm(BLANK); setEditingId(null); setShowForm(false); load();
    } catch { alert('Save failed'); }
    setSaving(false);
  };

  const toggleActive = async (b) => {
    await authedFetch(`/admin/branches/${b.id}`, { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({ is_active: !b.is_active }) });
    load();
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Branches</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{branches.length} branches · lab-owned locations</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>+ Add Branch</button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem' }}>{editingId ? 'Edit Branch' : 'New Branch'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Branch Name *</label><input style={inp} placeholder="Main Lab" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
            <div><label style={lbl}>Code</label><input style={inp} placeholder="MAIN" value={form.code} onChange={e=>setForm({...form,code:e.target.value})} /></div>
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Address</label><input style={inp} placeholder="Street, City" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={{ display:'flex', alignItems:'center', gap:'0.55rem', cursor:'pointer', fontSize:'0.85rem', color:'#0f1218' }}>
                <input type="checkbox" checked={form.is_main} onChange={e=>setForm({...form,is_main:e.target.checked})} style={{ width:'16px', height:'16px', accentColor:'#f97316', cursor:'pointer' }} />
                Main branch
              </label>
            </div>
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>{saving ? 'Saving…' : editingId ? 'Update Branch' : 'Create Branch'}</button>
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Name','Code','Address','Main','Status','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No branches yet.</td></tr>
            )}
            {branches.map(b => (
              <tr key={b.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{b.name}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.82rem', fontFamily:'monospace' }}>{b.code || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.82rem' }}>{b.address || '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>{b.is_main ? <span style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', padding:'0.2rem 0.6rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:700 }}>Main</span> : '—'}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:(b.is_active?'#16a34a':'#94a3b8')+'22', color:b.is_active?'#16a34a':'#94a3b8', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:800 }}>{b.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(b)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title={b.is_active ? 'Deactivate' : 'Activate'} onClick={()=>toggleActive(b)} style={iconBtn(b.is_active ? '#dc2626' : '#16a34a')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
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
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px', borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}
