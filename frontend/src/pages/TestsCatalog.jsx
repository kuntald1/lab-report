import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN');

export default function TestsCatalog() {
  const [tab, setTab]         = useState('tests');   // 'tests' | 'groups'
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

  const tube       = (id) => tubes.find(t=>t.id===id) || null;
  const doctorName = (id) => doctors.find(d=>d.id===id)?.name || '—';
  const tubeSwatch = (id) => {
    const t = tube(id);
    if (!t) return <span style={{ color:'#8892a4' }}>—</span>;
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:'0.45rem' }}>
        <span style={{ width:'13px', height:'13px', borderRadius:'50%', background:t.color||'#e5e7eb',
                       border:'1.5px solid rgba(0,0,0,0.12)', display:'inline-block', flexShrink:0 }} />
        <span>{t.name}</span>
      </span>
    );
  };

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

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.2rem', borderBottom:'1.5px solid #e8ecf4' }}>
        {[['tests','Tests'],['groups','Test Groups']].map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{ background:'transparent', border:'none', cursor:'pointer', padding:'0.6rem 1.1rem', fontFamily:'Manrope,sans-serif', fontWeight:700, fontSize:'0.88rem', color: tab===id?'#f97316':'#8892a4', borderBottom: tab===id?'2.5px solid #f97316':'2.5px solid transparent', marginBottom:'-1.5px' }}>{label}</button>
        ))}
      </div>

      {tab === 'groups' ? <TestGroups tests={tests} showToast={showToast} /> : (<>
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
                <td style={{ padding:'0.9rem 1.2rem', color:'#475569', fontSize:'0.82rem' }}>{tubeSwatch(t.sample_tube_id)}</td>
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
      </>)}
    </div>
  );
}

function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}

function TestGroups({ tests, showToast }) {
  const [groups, setGroups] = useState([]);
  const [form, setForm]     = useState(null);   // {id?, name, code, price, test_ids:[]}
  const [saving, setSaving] = useState(false);
  const [del, setDel]       = useState(null);
  const [tsearch, setTsearch] = useState('');

  const load = () => authedFetch('/b2b/test-groups').then(r=>r.ok?r.json():[]).then(setGroups).catch(()=>{});
  useEffect(() => { load(); }, []);

  const sumOf = (ids) => tests.filter(t=>ids.includes(t.id)).reduce((s,t)=>s+(Number(t.price)||0),0);
  const nameOf = (id) => tests.find(t=>t.id===id)?.name || '#'+id;

  const openNew  = () => setForm({ name:'', code:'', price:'', test_ids:[] });
  const openEdit = (g) => setForm({ id:g.id, name:g.name, code:g.code||'', price:g.price, test_ids:g.test_ids||[] });

  const toggleTest = (id) => {
    const ids = form.test_ids.includes(id) ? form.test_ids.filter(x=>x!==id) : [...form.test_ids, id];
    setForm({ ...form, test_ids: ids, price: sumOf(ids) });   // keep price synced to sum (user may override after)
  };

  const save = async () => {
    if (!form.name.trim())        { showToast('error','Group name is required'); return; }
    if (form.test_ids.length===0) { showToast('error','Pick at least one test'); return; }
    setSaving(true);
    const payload = { name: form.name.trim(), code: form.code || null, price: Number(form.price)||0, test_ids: form.test_ids };
    const url    = form.id ? `/b2b/test-groups/${form.id}` : '/b2b/test-groups';
    const method = form.id ? 'PUT' : 'POST';
    try {
      const res = await authedFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setForm(null); load(); showToast('success', form.id ? 'Group updated' : 'Group created');
    } catch { showToast('error','Save failed'); }
    setSaving(false);
  };

  const doDelete = async () => {
    if (!del) return;
    try { const res = await authedFetch(`/b2b/test-groups/${del.id}`, { method:'DELETE' });
      if (!res.ok) throw new Error(); setDel(null); load(); showToast('success','Group deleted');
    } catch { setDel(null); showToast('error','Delete failed'); }
  };

  const tlist = tests.filter(t => !tsearch || t.name.toLowerCase().includes(tsearch.toLowerCase()));

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
        <div style={{ color:'#8892a4', fontSize:'0.82rem' }}>{groups.length} group(s) · a panel bundles several tests at one price</div>
        <button onClick={openNew} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.6rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>+ New Test Group</button>
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Group','Tests included','Sum of tests','Group Price','Actions'].map(h => (
                <th key={h} style={{ textAlign: (h==='Sum of tests'||h==='Group Price')?'right':'left', padding:'0.8rem 1.2rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>No test groups yet. Create one to bundle tests like a "Lipid Profile".</td></tr>}
            {groups.map(g => (
              <tr key={g.id} style={{ borderBottom:'1px solid #f4f6fa' }}>
                <td style={{ padding:'0.9rem 1.2rem', fontWeight:700, color:'#0f1218', fontSize:'0.86rem' }}>{g.name}{g.code && <span style={{ color:'#8892a4', fontWeight:500 }}> · {g.code}</span>}</td>
                <td style={{ padding:'0.9rem 1.2rem' }}>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'0.3rem' }}>
                    {(g.tests||[]).map(t => <span key={t.id} style={{ background:'rgba(249,115,22,0.08)', color:'#c2410c', padding:'0.15rem 0.55rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:600 }}>{t.name}</span>)}
                  </div>
                </td>
                <td style={{ padding:'0.9rem 1.2rem', textAlign:'right', color:'#8892a4', fontSize:'0.83rem' }}>{inr(g.sum_price)}</td>
                <td style={{ padding:'0.9rem 1.2rem', textAlign:'right', color:'#16a34a', fontWeight:700, fontSize:'0.86rem' }}>{inr(g.price)}</td>
                <td style={{ padding:'0.9rem 1.2rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Edit" onClick={()=>openEdit(g)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Delete" onClick={()=>setDel(g)} style={iconBtn('#dc2626')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div onClick={()=>setForm(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ ...S.card, width:'560px', maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', fontSize:'1.1rem', marginBottom:'1rem' }}>{form.id ? 'Edit Test Group' : 'New Test Group'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'0.7rem', marginBottom:'0.8rem' }}>
              <div><label style={lbl}>Group name</label><input style={inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Lipid Profile" /></div>
              <div><label style={lbl}>Code (optional)</label><input style={inp} value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="LIPID" /></div>
            </div>

            <label style={lbl}>Tests in this group</label>
            <input style={{ ...inp, marginBottom:'0.5rem' }} placeholder="Filter tests…" value={tsearch} onChange={e=>setTsearch(e.target.value)} />
            <div style={{ flex:1, overflowY:'auto', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.3rem', marginBottom:'0.9rem', minHeight:'140px' }}>
              {tlist.map(t => {
                const on = form.test_ids.includes(t.id);
                return (
                  <label key={t.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.6rem', borderRadius:'8px', cursor:'pointer', background: on?'rgba(249,115,22,0.06)':'transparent' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:'0.55rem' }}>
                      <input type="checkbox" checked={on} onChange={()=>toggleTest(t.id)} style={{ accentColor:'#f97316', width:'15px', height:'15px' }} />
                      <span style={{ fontSize:'0.85rem', color:'#0f1218', fontWeight: on?700:500 }}>{t.name}</span>
                    </span>
                    <span style={{ fontSize:'0.8rem', color:'#16a34a', fontWeight:600 }}>{inr(t.price)}</span>
                  </label>
                );
              })}
            </div>

            <div style={{ display:'flex', alignItems:'flex-end', gap:'1rem', marginBottom:'1rem' }}>
              <div style={{ flex:1 }}>
                <label style={lbl}>Group price</label>
                <input style={inp} type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} />
              </div>
              <div style={{ fontSize:'0.78rem', color:'#8892a4', paddingBottom:'0.7rem' }}>
                Sum of tests: <strong style={{ color:'#0f1218' }}>{inr(sumOf(form.test_ids))}</strong>
                {Number(form.price) !== sumOf(form.test_ids) && <button onClick={()=>setForm({...form, price: sumOf(form.test_ids)})} style={{ marginLeft:'0.5rem', background:'transparent', border:'none', color:'#f97316', fontWeight:700, cursor:'pointer', fontSize:'0.78rem' }}>reset to sum</button>}
              </div>
            </div>

            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setForm(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':(form.id?'Save changes':'Create group')}</button>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div onClick={()=>setDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.1rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this group?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem' }}><strong style={{ color:'#0f1218' }}>{del.name}</strong> will be removed. Existing bills keep their items.</div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600 }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
