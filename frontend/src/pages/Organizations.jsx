import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const BLANK = {
  name:'', org_group_id:'', address:'', pan:'', aadhaar:'', gstin:'',
  contact_person:'', phone:'', email:'', credit_limit:'',
};

const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN');

export default function Organizations() {
  const [orgs, setOrgs]         = useState([]);
  const [groups, setGroups]     = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]         = useState(BLANK);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast]       = useState(null);
  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3000); };

  const load = () => {
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
    authedFetch('/b2b/org-groups').then(r=>r.ok?r.json():[]).then(setGroups).catch(()=>{});
  };
  useEffect(() => { load(); }, []);

  const groupName = (id) => groups.find(g=>g.id===id)?.name || '—';

  const doDelete = async () => {
    const o = confirmDel; if (!o) return;
    try {
      const res = await authedFetch(`/b2b/organizations/${o.id}`, { method:'DELETE' });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      setConfirmDel(null); load(); showToast('success', `Deleted ${o.name}`);
    } catch (e) { setConfirmDel(null); showToast('error', String(e.message||'Delete failed')); }
  };

  const openCreate = () => { setEditingId(null); setForm(BLANK); setShowForm(true); };
  const startEdit  = (o) => {
    setEditingId(o.id);
    setForm({
      name:o.name||'', org_group_id:o.org_group_id ?? '', address:o.address||'',
      pan:o.pan||'', aadhaar:o.aadhaar||'', gstin:o.gstin||'',
      contact_person:o.contact_person||'', phone:o.phone||'', email:o.email||'',
      credit_limit:o.credit_limit ?? '',
    });
    setShowForm(true);
    window.scrollTo({ top:0, behavior:'smooth' });
  };

  const submit = async () => {
    if (!form.name.trim()) return alert('Organization name required');
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      org_group_id: form.org_group_id ? parseInt(form.org_group_id) : null,
      address: form.address || null,
      pan: form.pan || null,
      aadhaar: form.aadhaar || null,
      gstin: form.gstin || null,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
      credit_limit: form.credit_limit ? parseInt(form.credit_limit) : 0,
    };
    try {
      const url = editingId ? `/b2b/organizations/${editingId}` : '/b2b/organizations';
      await authedFetch(url, { method: editingId ? 'PUT' : 'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      setForm(BLANK); setEditingId(null); setShowForm(false); load();
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
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this organization?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem', lineHeight:1.5 }}>
              <strong style={{ color:'#0f1218' }}>{confirmDel.name}</strong> will be removed from the list. Existing bills, ledger entries and saved pricing are kept for history.
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
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Organizations</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{orgs.length} organizations · referral partners &amp; collection centres</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
          + Add Organization
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ width:'28px', height:'28px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem' }}>🏥</span>
            {editingId ? 'Edit Organization' : 'New Organization'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Organization Name *</label><input style={inp} placeholder="e.g. XYZ Diagnostics" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
            <div><label style={lbl}>Group</label>
              <select style={inp} value={form.org_group_id} onChange={e=>setForm({...form,org_group_id:e.target.value})}>
                <option value="">— No group (standalone) —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></div>
            <div><label style={lbl}>Contact Person</label><input style={inp} placeholder="Name" value={form.contact_person} onChange={e=>setForm({...form,contact_person:e.target.value})} /></div>
            <div><label style={lbl}>Phone</label><input style={inp} placeholder="10-digit mobile" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
            <div><label style={lbl}>Email</label><input style={inp} type="email" placeholder="name@org.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></div>
            <div><label style={lbl}>Credit Limit (₹)</label><input style={inp} type="number" placeholder="0" value={form.credit_limit} onChange={e=>setForm({...form,credit_limit:e.target.value})} /></div>
            <div><label style={lbl}>PAN</label><input style={{...inp, fontFamily:'monospace', textTransform:'uppercase'}} placeholder="ABCDE1234F" value={form.pan} onChange={e=>setForm({...form,pan:e.target.value})} /></div>
            <div><label style={lbl}>Aadhaar</label><input style={{...inp, fontFamily:'monospace'}} placeholder="12-digit" value={form.aadhaar} onChange={e=>setForm({...form,aadhaar:e.target.value})} /></div>
            <div><label style={lbl}>GSTIN</label><input style={{...inp, fontFamily:'monospace', textTransform:'uppercase'}} placeholder="22ABCDE1234F1Z5" value={form.gstin} onChange={e=>setForm({...form,gstin:e.target.value})} /></div>
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Address</label><input style={inp} placeholder="Full address" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></div>
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
              {saving ? 'Saving...' : editingId ? 'Update Organization' : 'Add Organization'}
            </button>
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Name','Group','Contact','Phone','Credit Limit','PAN','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>
                <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>🏥</div>
                No organizations yet.
              </td></tr>
            )}
            {orgs.map(o => (
              <tr key={o.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{o.name}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  {o.org_group_id
                    ? <span style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>{groupName(o.org_group_id)}</span>
                    : <span style={{ color:'#8892a4', fontSize:'0.78rem' }}>Standalone</span>}
                </td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.83rem' }}>{o.contact_person||'—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.83rem' }}>{o.phone||'—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#0f1218', fontSize:'0.83rem', fontWeight:600 }}>{inr(o.credit_limit)}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.78rem', fontFamily:'monospace' }}>{o.pan||'—'}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(o)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setConfirmDel(o)} style={iconBtn('#dc2626')}>
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
