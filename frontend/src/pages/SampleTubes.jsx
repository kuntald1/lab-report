import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const BLANK = { name:'', color:'' };

// quick suggestions for the colour field (free text; CSS understands these names)
const COMMON = ['Red', 'Lavender', 'Blue', 'Green', 'Grey', 'Yellow', 'Black', 'Pink'];

export default function SampleTubes() {
  const [tubes, setTubes]       = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]         = useState(BLANK);

  const load = () => authedFetch('/b2b/tubes').then(r=>r.ok?r.json():[]).then(setTubes).catch(()=>{});
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditingId(null); setForm(BLANK); setShowForm(true); };
  const startEdit  = (t) => { setEditingId(t.id); setForm({ name:t.name||'', color:t.color||'' }); setShowForm(true); };

  const submit = async () => {
    if (!form.name.trim()) return alert('Tube name required');
    setSaving(true);
    try {
      const url = editingId ? `/b2b/tubes/${editingId}` : '/b2b/tubes';
      await authedFetch(url, { method: editingId ? 'PUT' : 'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: form.name.trim(), color: form.color.trim() || null }) });
      setForm(BLANK); setEditingId(null); setShowForm(false); load();
    } catch { alert('Save failed'); }
    setSaving(false);
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete tube "${t.name}"?`)) return;
    await authedFetch(`/b2b/tubes/${t.id}`, { method:'DELETE' });
    load();
  };

  const swatch = (color) => (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'0.5rem' }}>
      <span style={{ width:'16px', height:'16px', borderRadius:'50%', background:color||'#e5e7eb',
                     border:'1.5px solid rgba(0,0,0,0.12)', display:'inline-block' }} />
      <span style={{ color:'#0f1218', fontSize:'0.85rem' }}>{color || '—'}</span>
    </span>
  );

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Sample Tubes</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{tubes.length} tubes · collection container master</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
          + Add Tube
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem' }}>
            {editingId ? 'Edit Tube' : 'New Sample Tube'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Tube Name *</label>
              <input style={inp} placeholder="e.g. EDTA" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
            <div><label style={lbl}>Colour</label>
              <input style={inp} list="tube-colors" placeholder="e.g. Lavender" value={form.color} onChange={e=>setForm({...form,color:e.target.value})} />
              <datalist id="tube-colors">{COMMON.map(c => <option key={c} value={c} />)}</datalist>
            </div>
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
              {saving ? 'Saving...' : editingId ? 'Update Tube' : 'Add Tube'}
            </button>
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Tube Name','Colour','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tubes.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No sample tubes yet.</td></tr>
            )}
            {tubes.map(t => (
              <tr key={t.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{t.name}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>{swatch(t.color)}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(t)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>remove(t)} style={iconBtn('#dc2626')}>
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
