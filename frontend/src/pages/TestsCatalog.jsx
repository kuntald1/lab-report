import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN');

export default function TestsCatalog() {
  const [tests, setTests]     = useState([]);
  const [tubes, setTubes]     = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [search, setSearch]   = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);   // the test pending deletion

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3000); };

  const load = () => authedFetch('/b2b/tests').then(r=>r.ok?r.json():[]).then(setTests).catch(()=>{});
  useEffect(() => {
    load();
    authedFetch('/b2b/tubes').then(r=>r.ok?r.json():[]).then(setTubes).catch(()=>{});
    authedFetch('/b2b/doctors').then(r=>r.ok?r.json():[]).then(setDoctors).catch(()=>{});
  }, []);

  const tubeName   = (id) => tubes.find(t=>t.id===id)?.name || '—';
  const doctorName = (id) => doctors.find(d=>d.id===id)?.name || '—';

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      mrp: t.mrp ?? '', price: t.price ?? '', normal_value: t.normal_value || '',
      sample_tube_id: t.sample_tube_id ?? '', assigned_doctor_id: t.assigned_doctor_id ?? '',
    });
  };

  const save = async (t) => {
    setSaving(true);
    const payload = {
      mrp: form.mrp === '' ? null : Number(form.mrp),
      price: form.price === '' ? null : Number(form.price),
      normal_value: form.normal_value || null,
      sample_tube_id: form.sample_tube_id ? parseInt(form.sample_tube_id) : null,
      assigned_doctor_id: form.assigned_doctor_id ? parseInt(form.assigned_doctor_id) : null,
    };
    try {
      const res = await authedFetch(`/b2b/tests/${t.id}`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setEditingId(null); load();
      showToast('success', `Updated ${t.name}`);
    } catch { showToast('error', 'Save failed'); }
    setSaving(false);
  };

  const filtered = tests.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  const doDelete = async () => {
    const t = confirmDel; if (!t) return;
    try {
      const res = await authedFetch(`/b2b/tests/${t.id}`, { method:'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmDel(null); load();
      showToast('success', `Deleted ${t.name}`);
    } catch { setConfirmDel(null); showToast('error', 'Delete failed'); }
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
        <div onClick={()=>setConfirmDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeIn 0.15s ease' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ width:'48px', height:'48px', borderRadius:'12px', background:'rgba(220,38,38,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem', marginBottom:'1rem' }}>🗑️</div>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this test?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem', lineHeight:1.5 }}>
              <strong style={{ color:'#0f1218' }}>{confirmDel.name}</strong> will be removed from the catalog. Existing bills and saved group/org pricing keep their copies — this only hides it from new selections.
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setConfirmDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(220,38,38,0.3)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity:0;} to { opacity:1;} }`}</style>

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Tests Catalog</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{tests.length} tests · set MRP, price, normal value, sample tube &amp; assigned doctor</p>
      </div>

      <div style={{ ...S.card, marginBottom:'1.2rem', padding:'1rem 1.5rem' }}>
        <input style={{ ...inp, maxWidth:'360px' }} placeholder="Search tests…" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Test','MRP','Price','Normal Value','Sample Tube','Assigned Doctor','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.2rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No tests found.</td></tr>
            )}
            {filtered.map(t => editingId === t.id ? (
              <tr key={t.id} style={{ borderBottom:'1px solid #f4f6fa', background:'rgba(249,115,22,0.03)' }}>
                <td style={{ padding:'0.7rem 1.2rem', fontWeight:700, color:'#0f1218', fontSize:'0.85rem' }}>{t.name}</td>
                <td style={{ padding:'0.7rem 1.2rem' }}><input style={{ ...inp, width:'80px', padding:'0.4rem 0.6rem' }} type="number" value={form.mrp} onChange={e=>setForm({...form,mrp:e.target.value})} /></td>
                <td style={{ padding:'0.7rem 1.2rem' }}><input style={{ ...inp, width:'80px', padding:'0.4rem 0.6rem' }} type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></td>
                <td style={{ padding:'0.7rem 1.2rem' }}><input style={{ ...inp, width:'130px', padding:'0.4rem 0.6rem' }} value={form.normal_value} onChange={e=>setForm({...form,normal_value:e.target.value})} placeholder="e.g. < 200" /></td>
                <td style={{ padding:'0.7rem 1.2rem' }}>
                  <select style={{ ...inp, width:'140px', padding:'0.4rem 0.6rem' }} value={form.sample_tube_id} onChange={e=>setForm({...form,sample_tube_id:e.target.value})}>
                    <option value="">—</option>
                    {tubes.map(tb => <option key={tb.id} value={tb.id}>{tb.name}</option>)}
                  </select>
                </td>
                <td style={{ padding:'0.7rem 1.2rem' }}>
                  <select style={{ ...inp, width:'150px', padding:'0.4rem 0.6rem' }} value={form.assigned_doctor_id} onChange={e=>setForm({...form,assigned_doctor_id:e.target.value})}>
                    <option value="">— Unassigned —</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td style={{ padding:'0.7rem 1.2rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button onClick={()=>save(t)} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'8px', padding:'0.4rem 0.9rem', fontWeight:700, cursor:'pointer', fontSize:'0.78rem', fontFamily:'Manrope,sans-serif' }}>{saving?'…':'Save'}</button>
                    <button onClick={()=>setEditingId(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'8px', padding:'0.4rem 0.8rem', cursor:'pointer', fontSize:'0.78rem' }}>Cancel</button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={t.id} style={{ borderBottom:'1px solid #f4f6fa' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.2rem', fontWeight:700, color:'#0f1218', fontSize:'0.86rem' }}>{t.name}</td>
                <td style={{ padding:'0.9rem 1.2rem', color:'#8892a4', fontSize:'0.83rem' }}>{inr(t.mrp)}</td>
                <td style={{ padding:'0.9rem 1.2rem', color:'#16a34a', fontWeight:600, fontSize:'0.83rem' }}>{inr(t.price)}</td>
                <td style={{ padding:'0.9rem 1.2rem', color:'#475569', fontSize:'0.82rem' }}>{t.normal_value || '—'}</td>
                <td style={{ padding:'0.9rem 1.2rem', color:'#475569', fontSize:'0.82rem' }}>{tubeName(t.sample_tube_id)}</td>
                <td style={{ padding:'0.9rem 1.2rem', color:'#475569', fontSize:'0.82rem' }}>{doctorName(t.assigned_doctor_id)}</td>
                <td style={{ padding:'0.9rem 1.2rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>startEdit(t)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setConfirmDel(t)} style={iconBtn('#dc2626')}>
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
