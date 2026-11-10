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
  const [form, setForm]       = useState(null);   // null = modal closed; object = create/edit modal open
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

  const BLANK_TEST = { name:'', code:'', unit:'', method:'', mrp:'', price:'', normal_value:'',
                        sample_tube_id:'', assigned_doctor_id:'', disclaimer:'', interpretation:'',
                        parameters:'' };
  const openNew  = () => setForm({ ...BLANK_TEST });
  const openEdit = (t) => setForm({
    id: t.id, name: t.name || '', code: t.code || '', unit: t.unit || '', method: t.method || '',
    mrp: t.mrp ?? '', price: t.price ?? '', normal_value: t.normal_value || '',
    sample_tube_id: t.sample_tube_id ?? '', assigned_doctor_id: t.assigned_doctor_id ?? '',
    disclaimer: t.disclaimer || '', interpretation: t.interpretation || '',
    parameters: t.parameters || '',
  });

  const save = async () => {
    if (!form.name.trim()) { showToast('error', 'Test name is required'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), code: form.code || null, unit: form.unit || null, method: form.method || null,
      mrp: form.mrp === '' ? null : Number(form.mrp),
      price: form.price === '' ? null : Number(form.price),
      normal_value: form.normal_value || null,
      sample_tube_id: form.sample_tube_id ? parseInt(form.sample_tube_id) : null,
      assigned_doctor_id: form.assigned_doctor_id ? parseInt(form.assigned_doctor_id) : null,
      disclaimer: form.disclaimer || null,
      interpretation: form.interpretation || null,
      parameters: form.parameters || null,
    };
    const url    = form.id ? `/b2b/tests/${form.id}` : '/b2b/tests';
    const method = form.id ? 'PUT' : 'POST';
    try {
      const res = await authedFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setForm(null); load();
      showToast('success', form.id ? `Updated ${payload.name}` : `Added ${payload.name}`);
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

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Tests Catalog</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{tests.length} tests · set MRP, price, normal value, sample tube &amp; assigned doctor</p>
        </div>
        {tab === 'tests' && (
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
            <ExcelBar kind="tests" noun="Tests" showToast={showToast} onDone={load} />
            <button onClick={openNew} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem 1.3rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>+ Add Test</button>
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.2rem', borderBottom:'1.5px solid #e8ecf4' }}>
        {[['tests','Tests'],['groups','Test Groups'],['ranges','Reference Ranges'],['parameters','Parameters']].map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{ background:'transparent', border:'none', cursor:'pointer', padding:'0.6rem 1.1rem', fontFamily:'Manrope,sans-serif', fontWeight:700, fontSize:'0.88rem', color: tab===id?'#f97316':'#8892a4', borderBottom: tab===id?'2.5px solid #f97316':'2.5px solid transparent', marginBottom:'-1.5px' }}>{label}</button>
        ))}
      </div>

      {tab === 'parameters' ? <ParameterList showToast={showToast} /> :
       tab === 'ranges' ? <ReferenceRanges tests={tests} showToast={showToast} /> :
       tab === 'groups' ? <TestGroups tests={tests} showToast={showToast} /> : (<>
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
            {filtered.map(t => (
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
                    <button title="Edit" onClick={()=>openEdit(t)} style={iconBtn('#2563eb')}>
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

      {form && (
        <div onClick={()=>setForm(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ ...S.card, width:'620px', maxWidth:'96vw', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', fontSize:'1.1rem', marginBottom:'1rem' }}>{form.id ? 'Edit Test' : 'Add Test'}</div>

            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'0.7rem', marginBottom:'0.8rem' }}>
              <div><label style={lbl}>Test Name</label><input style={inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. HDL Cholesterol" /></div>
              <div><label style={lbl}>Code (optional)</label><input style={inp} value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="HDL" /></div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem', marginBottom:'0.8rem' }}>
              <div><label style={lbl}>Unit</label><input style={inp} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="mg/dL" /></div>
              <div><label style={lbl}>Method</label><input style={inp} value={form.method} onChange={e=>setForm({...form,method:e.target.value})} placeholder="e.g. Direct measure-PEG" /></div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem', marginBottom:'0.8rem' }}>
              <div><label style={lbl}>MRP</label><input style={inp} type="number" value={form.mrp} onChange={e=>setForm({...form,mrp:e.target.value})} /></div>
              <div><label style={lbl}>Price</label><input style={inp} type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></div>
            </div>

            <div style={{ marginBottom:'0.8rem' }}>
              <label style={lbl}>Normal Value / Reference Range</label>
              <input style={inp} value={form.normal_value} onChange={e=>setForm({...form,normal_value:e.target.value})} placeholder="e.g. < 200 mg/dL" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem', marginBottom:'0.9rem' }}>
              <div><label style={lbl}>Sample Tube</label>
                <select style={inp} value={form.sample_tube_id} onChange={e=>setForm({...form,sample_tube_id:e.target.value})}>
                  <option value="">—</option>
                  {tubes.map(tb => <option key={tb.id} value={tb.id}>{tb.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Assigned Doctor</label>
                <select style={inp} value={form.assigned_doctor_id} onChange={e=>setForm({...form,assigned_doctor_id:e.target.value})}>
                  <option value="">— Unassigned —</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom:'0.9rem' }}>
              <label style={lbl}>Parameters printed on the report</label>
              <input style={inp} value={form.parameters}
                     onChange={e=>setForm({...form,parameters:e.target.value})}
                     placeholder="e.g. Sodium   (leave blank for all)" />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem', lineHeight:1.5 }}>
                An analyser sends everything it measures at once — the Erba EC 90 always
                reports Sodium, Potassium and Chloride. Name the ones this test reports,
                separated by commas, and the rest are left off the report.
                <b> Leave it blank to print every parameter</b>, which is what every test does now.
              </div>
            </div>

            <div style={{ borderTop:'1px solid #e8ecf4', paddingTop:'0.9rem', marginBottom:'0.9rem' }}>
              <label style={lbl}>Interpretation</label>
              <textarea style={{ ...inp, minHeight:'80px', resize:'vertical', fontFamily:'Manrope,sans-serif' }}
                value={form.interpretation} onChange={e=>setForm({...form,interpretation:e.target.value})}
                placeholder="e.g. LDL > 130 mg/dL indicates elevated cardiovascular risk..." />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>Shown on the report, below this test's results.</div>
            </div>

            <div style={{ marginBottom:'1.2rem' }}>
              <label style={lbl}>Disclaimer</label>
              <textarea style={{ ...inp, minHeight:'70px', resize:'vertical', fontFamily:'Manrope,sans-serif' }}
                value={form.disclaimer} onChange={e=>setForm({...form,disclaimer:e.target.value})}
                placeholder="e.g. This test requires a 10-12 hour fasting sample..." />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>Shown on the report, below this test's results.</div>
            </div>

            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setForm(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':(form.id?'Save changes':'Add Test')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Download the sheet, edit it in Excel, upload it back.
 *
 * An upload is always validated first with dry_run, so the lab sees "3 new,
 * 12 updated" and can still back out. Nothing is written until they confirm,
 * and a sheet with any error at all writes nothing — the server reports every
 * bad row at once rather than one per attempt.
 */
export function ExcelBar({ kind, noun, showToast, onDone, caption }) {
  const [busy, setBusy]       = useState('');
  const [preview, setPreview] = useState(null);   // { file, created, updated }
  const [errs, setErrs]       = useState(null);   // { message, errors[], error_count }
  const inputId = `xl-${kind}`;

  async function download(which = 'export') {
    setBusy(which);
    try {
      const res = await authedFetch(`/catalog-xlsx/${which}/${kind}`);
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = which === 'sample' ? `${kind}-SAMPLE.xlsx` : `${kind}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast('success', which === 'sample' ? 'Sample file downloaded' : `${noun} downloaded`);
    } catch { showToast('error', which === 'sample' ? 'Could not fetch the sample' : 'Export failed'); }
    finally { setBusy(''); }
  }

  async function send(file, dry) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await authedFetch(`/catalog-xlsx/import/${kind}?dry_run=${dry}`,
                                  { method:'POST', body: fd });
    let body = null;
    try { body = await res.json(); } catch { /* keep null */ }
    return { ok: res.ok, body };
  }

  async function picked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                    // so the same file can be picked twice
    if (!file) return;
    setBusy('import');
    const { ok, body } = await send(file, true);
    setBusy('');
    if (!ok) {
      const d = body && body.detail;
      setErrs(typeof d === 'string' ? { message: d, errors: [] }
                                    : (d || { message: 'That file could not be read', errors: [] }));
      return;
    }
    if (!body.created && !body.updated) { showToast('error', 'That sheet has no rows to import'); return; }
    setPreview({ file, ...body });
  }

  async function confirm() {
    setBusy('import');
    const { ok, body } = await send(preview.file, false);
    setBusy(''); setPreview(null);
    if (!ok) {
      const d = body && body.detail;
      setErrs(typeof d === 'string' ? { message: d, errors: [] } : (d || { message:'Import failed', errors: [] }));
      return;
    }
    showToast('success', body.message);
    onDone && onDone();
  }

  const btn = {
    background:'#fff', border:'1.5px solid #e8ecf4', borderRadius:'10px', padding:'0.6rem 1rem',
    fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.8rem',
    color:'#55617a', whiteSpace:'nowrap',
  };
  const btnStyle = btn;

  return (
    <>
      {caption && <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#8892a4', textTransform:'uppercase', letterSpacing:'0.06em' }}>{caption}</span>}
      <button onClick={() => download('export')} disabled={!!busy} style={btnStyle}
              title={`Download your ${noun} as Excel`}>
        {busy === 'export' ? 'Preparing…' : '⭳  Export Excel'}
      </button>
      {/* a filled-in template, so nobody has to guess the columns before their
          first import. Its rows are examples and its ids are blank. */}
      <button onClick={() => download('sample')} disabled={!!busy}
              style={{ ...btnStyle, border:'1.5px dashed #d7dfea', color:'#7c8aa0' }}
              title={`A filled-in example ${noun} sheet to learn the format`}>
        {busy === 'sample' ? 'Preparing…' : '◳  Sample file'}
      </button>
      <label htmlFor={inputId} style={{ ...btnStyle, display:'inline-block' }} title={`Upload an edited ${noun} sheet`}>
        {busy === 'import' ? 'Checking…' : '⭱  Import Excel'}
      </label>
      <input id={inputId} type="file" accept=".xlsx" onChange={picked} style={{ display:'none' }} />

      {preview && (
        <div onClick={()=>setPreview(null)} style={OVERLAY}>
          <div onClick={e=>e.stopPropagation()} style={{ ...SHEET, width:'430px' }}>
            <div style={MODAL_TITLE}>Import {noun}?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', lineHeight:1.6, marginBottom:'1.3rem' }}>
              <div><strong style={{ color:'#16a34a' }}>{preview.created}</strong> will be added.</div>
              <div><strong style={{ color:'#f97316' }}>{preview.updated}</strong> will be updated.</div>
              <div style={{ marginTop:'0.6rem' }}>Nothing is deleted — anything missing from the sheet is left as it is.</div>
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setPreview(null)} style={GHOST}>Cancel</button>
              <button onClick={confirm} disabled={busy==='import'} style={PRIMARY}>
                {busy==='import' ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {errs && (
        <div onClick={()=>setErrs(null)} style={OVERLAY}>
          <div onClick={e=>e.stopPropagation()} style={{ ...SHEET, width:'620px', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={MODAL_TITLE}>Nothing was imported</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1rem' }}>
              {errs.message}{errs.error_count > (errs.errors||[]).length
                ? ` (showing the first ${(errs.errors||[]).length} of ${errs.error_count})` : ''}
            </div>
            {(errs.errors||[]).length > 0 && (
              <ul style={{ margin:0, paddingLeft:'1.1rem', color:'#b91c1c', fontSize:'0.8rem', lineHeight:1.8 }}>
                {errs.errors.map((e,i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'1.4rem' }}>
              <button onClick={()=>setErrs(null)} style={PRIMARY}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const OVERLAY = { position:'fixed', inset:0, zIndex:9996, background:'rgba(15,18,24,0.45)',
                  display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' };
const SHEET   = { background:'#fff', borderRadius:'16px', padding:'1.8rem', maxWidth:'95vw',
                  boxShadow:'0 20px 60px rgba(15,18,24,0.3)' };
const MODAL_TITLE = { fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800,
                      color:'#0f1218', marginBottom:'0.5rem' };
const GHOST   = { background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px',
                  padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' };
const PRIMARY = { background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none',
                  borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700,
                  fontFamily:'Manrope,sans-serif' };


function iconBtn(color) {
  return { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'30px', height:'30px',
           borderRadius:'8px', cursor:'pointer', background:color+'12', color, border:'1px solid '+color+'33' };
}


// ─────────────────────────────────────────────────────────────────────────────
// Reference ranges — what the report prints beside each value, and what decides
// whether it reads HIGH or LOW. Edited here rather than in code, because they
// differ by lab, and because a correction applies to reports already issued.
// ─────────────────────────────────────────────────────────────────────────────
// `scope` is not stored — it is test_id put into words. It exists because
// "common or just this test" is a decision, and as one more line in a list of
// test names it did not read like one, which is where the confusion started.
// `_was` remembers the test_id a row was opened with, so turning a common row
// into a per-test one can offer to copy rather than silently move it.
const BLANK_RANGE = { param:'', test_id:'', scope:'common', _was:null, sex:'A', age_min:'', age_max:'',
                      age_min_months:'', age_max_months:'', low:'', high:'',
                      critical_low:'', critical_high:'', unit:'', text:'', method:'', device_id:'', is_active:true };

const SEX_LABEL = { M:'Male', F:'Female', A:'Any', C:'Children' };

const PILL = { fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em',
               padding:'4px 11px', borderRadius:'100px', whiteSpace:'nowrap' };
const PILL_COMMON = { ...PILL, background:'rgba(23,163,116,0.1)', border:'1px solid rgba(23,163,116,0.28)', color:'#15855f' };
const PILL_TEST   = { ...PILL, background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316' };

/** One of the two Applies-to choices. */
function ScopeOption({ on, title, sub, onPick }) {
  return (
    <div onClick={onPick}
         style={{ border:`1.5px solid ${on ? '#f97316' : '#e8ecf4'}`, borderRadius:'11px',
                  padding:'0.75rem 0.85rem', background: on ? 'rgba(249,115,22,0.05)' : '#fff',
                  boxShadow: on ? '0 0 0 3px rgba(249,115,22,0.09)' : 'none',
                  display:'flex', gap:'0.6rem', alignItems:'flex-start', cursor:'pointer' }}>
      <span style={{ width:'16px', height:'16px', borderRadius:'50%', flex:'0 0 auto', marginTop:'1px',
                     border:`1.5px solid ${on ? '#f97316' : '#c9d2df'}`, background:'#fff',
                     display:'flex', alignItems:'center', justifyContent:'center' }}>
        {on && <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#f97316' }} />}
      </span>
      <span>
        <span style={{ display:'block', fontSize:'0.84rem', fontWeight:700, lineHeight:1.25 }}>{title}</span>
        <span style={{ display:'block', fontSize:'0.71rem', color:'#8892a4', marginTop:'0.2rem', lineHeight:1.4 }}>{sub}</span>
      </span>
    </div>
  );
}

function ReferenceRanges({ tests, showToast }) {
  const [rows, setRows]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [search, setSearch] = useState('');
  // Collapsed by default: with 147 shared ranges the useful first view is the
  // shape of the catalog, not a wall of rows. A search overrides it below —
  // a hit hidden inside a shut group is the same as no hit at all.
  const [open, setOpen]     = useState({});
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [del, setDel]       = useState(null);
  const [devices, setDevices] = useState([]);
  const [testQ, setTestQ]   = useState('');   // the picker's own search
  const [ask, setAsk]       = useState(null); // common → this-test-only: copy or move?

  // While searching, every group that still has rows is open — otherwise the
  // matches sit inside closed cards and the search looks broken.
  const isOpen = (key) => (search.trim() ? true : !!open[key]);
  const toggle = (key) => setOpen(o => ({ ...o, [key]: !o[key] }));

  // The analyser list, so a methodology can be pinned to the machine that
  // actually produced the value rather than to every machine reporting it.
  useEffect(() => { authedFetch('/devices/')
    .then(r => r.ok ? r.json() : [])
    .then(d => setDevices(Array.isArray(d) ? d : []))
    .catch(() => {}); }, []);

  const load = () => authedFetch('/catalog/reference-ranges')
    .then(r => r.ok ? r.json() : [])
    .then(d => { setRows(Array.isArray(d) ? d : []); setLoad(false); })
    .catch(() => setLoad(false));
  // Called inside the body, not passed straight to useEffect: `load` returns a
  // promise, and React takes whatever an effect returns to be its cleanup
  // function. Passed directly, leaving this tab made React call that promise —
  // "c is not a function" — which took the whole page down to a blank screen.
  useEffect(() => { load(); }, []);

  const testName   = (id) => tests.find(t => t.id === id)?.name || null;
  const deviceName = (id) => devices.find(d => d.id === id)?.name || (id ? `Device #${id}` : null);

  const num = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);
  const payloadOf = (f) => ({
    param: f.param.trim(), test_id: f.scope === 'test' && f.test_id ? Number(f.test_id) : null,
    sex: f.sex,
    age_min: num(f.age_min), age_max: num(f.age_max),
    age_min_months: num(f.age_min_months), age_max_months: num(f.age_max_months),
    low: num(f.low), high: num(f.high),
    critical_low: num(f.critical_low), critical_high: num(f.critical_high),
    unit: f.unit.trim() || null, text: f.text.trim() || null,
    method: f.method.trim() || null,
    device_id: f.device_id ? Number(f.device_id) : null,
    is_active: f.is_active !== false,
  });

  /** id null = create a new row; otherwise update that one. */
  const persist = async (id, payload, okMsg) => {
    setSaving(true);
    try {
      const res = await authedFetch(
        id ? `/catalog/reference-ranges/${id}` : '/catalog/reference-ranges',
        { method: id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setAsk(null); setForm(null); load();
      showToast('success', okMsg);
    } catch { showToast('error', 'Save failed'); }
    finally { setSaving(false); }
  };

  const save = async () => {
    if (!form.param.trim()) { showToast('error', 'Parameter is required'); return; }
    if (form.scope === 'test' && !form.test_id) { showToast('error', 'Pick the test this range is for'); return; }
    if (form.low === '' && form.high === '' && !form.text.trim() && !form.method.trim()) {
      showToast('error', 'Give a low, a high, a text range, or a method'); return;
    }
    // Narrowing a common row to one test would quietly strip the default from
    // every other test, so ask which was meant rather than guessing.
    if (form.id && form._was === '' && form.scope === 'test') { setAsk(form); return; }
    await persist(form.id || null, payloadOf(form), form.id ? 'Range updated' : 'Range added');
  };

  const doDelete = async () => {
    const r = del; if (!r) return;
    try {
      const res = await authedFetch(`/catalog/reference-ranges/${r.id}`, { method:'DELETE' });
      if (!res.ok) throw new Error();
      setDel(null); load(); showToast('success', 'Range deleted');
    } catch { setDel(null); showToast('error', 'Delete failed'); }
  };

  // How a row's age band reads on screen — months win when they're filled,
  // since that's the band the lookup will use for an infant.
  const ageText = (r) => {
    if (r.age_min_months != null || r.age_max_months != null)
      return `${r.age_min_months ?? 0}–${r.age_max_months ?? '∞'} mo`;
    if (r.age_min != null || r.age_max != null)
      return `${r.age_min ?? 0}–${r.age_max ?? '∞'} yr`;
    return 'Any age';
  };
  const rangeText = (r) => {
    if (r.text) return r.text;
    if (r.low != null && r.high != null) return `${r.low} – ${r.high}`;
    if (r.high != null) return `< ${r.high}`;
    if (r.low != null) return `> ${r.low}`;
    return '—';
  };

  const q = search.trim().toLowerCase();
  const shown = rows.filter(r => !q || (r.param||'').toLowerCase().includes(q)
                                   || (testName(r.test_id)||'').toLowerCase().includes(q));
  // Grouped the way the lab reads it: the shared ranges first, then one block
  // per test. Grouping by parameter instead scattered a single test's settings
  // across the page, which is what staff reported as confusing.
  const byParam = (a, b) =>
    (a.param||'').toUpperCase().localeCompare((b.param||'').toUpperCase()) || (a.id - b.id);
  const common = shown.filter(r => !r.test_id).sort(byParam);
  const perTest = new Map();
  shown.filter(r => r.test_id).forEach(r => {
    if (!perTest.has(r.test_id)) perTest.set(r.test_id, []);
    perTest.get(r.test_id).push(r);
  });
  const groups = [];
  if (common.length) groups.push({ key:'__common', common:true, title:'Shared ranges', rows:common });
  [...perTest.entries()]
    .map(([id, rs]) => ({ key:'t'+id, common:false, title: testName(id) || `Test #${id}`,
                          rows: rs.sort(byParam) }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach(g => groups.push(g));

  // Which tests name this parameter in "Parameters printed on the report".
  // That field is optional and blank means "print whatever the analyser sent",
  // so a test can report the parameter without turning up here — which is why
  // the warning that uses this always ends with "and any other test".
  const testsDeclaring = (param) => {
    const p = (param || '').trim().toUpperCase();
    if (!p) return [];
    return tests.filter(t => String(t.parameters || '').split(',')
                               .map(s => s.trim().toUpperCase()).filter(Boolean).includes(p));
  };

  return (
    <>
      <div style={{ ...S.card, marginBottom:'1.2rem', padding:'1rem 1.5rem', display:'flex',
                    gap:'0.8rem', alignItems:'center', flexWrap:'wrap' }}>
        <input style={{ ...inp, maxWidth:'320px' }} placeholder="Search parameter or test…"
               value={search} onChange={e=>setSearch(e.target.value)} />
        <div style={{ flex:1 }} />
        <ExcelBar kind="reference-ranges" noun="Reference Ranges" showToast={showToast} onDone={load} />
        <button onClick={()=>{ setTestQ(''); setForm({ ...BLANK_RANGE }); }}
                style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none',
                         borderRadius:'10px', padding:'0.7rem 1.3rem', fontWeight:700, cursor:'pointer',
                         fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap',
                         boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>+ Add Range</button>
      </div>

      <div style={{ ...S.card, marginBottom:'1.2rem', padding:'0.9rem 1.2rem', background:'#fffbeb',
                    border:'1px solid #fde68a', color:'#92400e', fontSize:'0.8rem', lineHeight:1.6 }}>
        These decide the reference range printed on the report and whether a value reads HIGH or LOW.
        A <b>common</b> range applies wherever that parameter is reported; a <b>this test only</b> range
        overrides it for that one test. Where several could apply, the one matching the patient's age wins,
        then sex, then test. A parameter with no range here keeps whatever the analyser sent. A methodology
        can be pinned to one analyser; a row naming yours beats one that names none.
      </div>

      {loading ? (
        <div style={{ ...S.card, textAlign:'center', color:'#8892a4', padding:'2.5rem' }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ ...S.card, textAlign:'center', color:'#8892a4', padding:'2.5rem' }}>
          {rows.length === 0 ? 'No reference ranges yet — reports use whatever each analyser sends.'
                             : 'Nothing matches that search.'}
        </div>
      ) : groups.map(g => (
        <div key={g.key} style={{ ...S.card, marginBottom:'0.9rem', padding:'1.1rem 1.4rem' }}>
          <div onClick={()=>toggle(g.key)} role="button" tabIndex={0} aria-expanded={isOpen(g.key)}
               onKeyDown={e=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.key); } }}
               style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap',
                        cursor:'pointer', userSelect:'none',
                        marginBottom: isOpen(g.key) ? '0.7rem' : 0 }}>
            <span aria-hidden="true"
                  style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
                           width:'22px', height:'22px', borderRadius:'7px', flexShrink:0,
                           background:'#f4f7fb', color:'#55617a', fontSize:'0.62rem',
                           transition:'transform 0.15s ease',
                           transform: isOpen(g.key) ? 'rotate(90deg)' : 'none' }}>▶</span>
            <span style={g.common ? PILL_COMMON : PILL_TEST}>{g.common ? 'Common · all tests' : 'This test only'}</span>
            <span style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'0.95rem', color:'#0f1218' }}>
              {g.title}
            </span>
            <span style={{ color:'#8892a4', fontWeight:600, fontSize:'0.78rem' }}>· {g.rows.length} range{g.rows.length>1?'s':''}</span>
          </div>
          {isOpen(g.key) && (<>
          {g.common && (
            <div style={{ fontSize:'0.74rem', color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a',
                          borderRadius:'8px', padding:'0.55rem 0.75rem', marginBottom:'0.8rem', lineHeight:1.5 }}>
              These apply wherever the parameter is reported. Changing one here changes it for every test.
            </div>
          )}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ color:'#8892a4', fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Parameter</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Patient Group</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Age</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Range</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Critical</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem' }}>Method</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map(r => (
                <tr key={r.id} style={{ borderTop:'1px solid #f1f4f9', opacity: r.is_active === false ? 0.5 : 1 }}>
                  <td style={{ padding:'0.5rem', fontWeight:700 }}>{r.param || '—'}
                    {r.is_active === false && (
                      <span style={{ marginLeft:'0.5rem', fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase',
                                     letterSpacing:'0.06em', color:'#92400e', background:'#fffbeb',
                                     border:'1px solid #fde68a', borderRadius:'100px', padding:'2px 8px' }}>Inactive</span>
                    )}
                  </td>
                  <td style={{ padding:'0.5rem' }}>{SEX_LABEL[(r.sex||'A').toUpperCase()] || r.sex}</td>
                  <td style={{ padding:'0.5rem', color:'#8892a4' }}>{ageText(r)}</td>
                  <td style={{ padding:'0.5rem', fontWeight:700 }}>{rangeText(r)} {r.unit || ''}</td>
                  <td style={{ padding:'0.5rem', color:'#dc2626' }}>
                    {r.critical_low != null || r.critical_high != null
                      ? `${r.critical_low ?? '—'} / ${r.critical_high ?? '—'}` : '—'}
                  </td>
                  <td style={{ padding:'0.5rem', color:'#8892a4' }}>
                    {r.method || '—'}
                    {r.method && r.device_id ? (
                      <div style={{ fontSize:'0.68rem', color:'#f97316' }}>{deviceName(r.device_id)}</div>
                    ) : null}
                  </td>
                  <td style={{ padding:'0.5rem', textAlign:'right', whiteSpace:'nowrap' }}>
                    <span onClick={()=>{ setTestQ('');
                            setForm({ ...BLANK_RANGE, ...Object.fromEntries(
                              Object.entries(r).map(([k,v]) => [k, v == null ? '' : v])),
                              scope: r.test_id ? 'test' : 'common', _was: r.test_id || '' }); }}
                          style={{ ...iconBtn('#f97316'), marginRight:'0.4rem' }} title="Edit">✎</span>
                    <span onClick={()=>setDel(r)} style={iconBtn('#dc2626')} title="Delete">✕</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>)}
        </div>
      ))}

      {del && (
        <div onClick={()=>setDel(null)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'400px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.15rem', fontWeight:800, color:'#0f1218', marginBottom:'0.4rem' }}>Delete this range?</div>
            <div style={{ color:'#8892a4', fontSize:'0.85rem', marginBottom:'1.5rem', lineHeight:1.5 }}>
              <strong style={{ color:'#0f1218' }}>{del.param}</strong> · {SEX_LABEL[(del.sex||'A').toUpperCase()]} · {ageText(del)}.
              Reports will fall back to the next range that fits, or to whatever the analyser sent.
            </div>
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setDel(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={doDelete} style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.5rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div onClick={()=>setForm(null)} style={{ position:'fixed', inset:0, zIndex:9997, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem', overflowY:'auto' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'640px', maxWidth:'95vw', maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.2rem', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem' }}>
              {form.id ? 'Edit reference range' : 'Add reference range'}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Parameter *</label>
                <input style={inp} value={form.param} placeholder="HGB, WBC, NEUT%, TSH II…"
                       onChange={e=>setForm({ ...form, param:e.target.value })} />
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                  Exactly as the analyser reports it. Capitals don't matter.
                </div>
              </div>
            </div>

            {/* Applies to — the one decision that used to hide as the first
                entry in a list of test names. The test picker only appears
                once "This test only" is chosen, so the common case never meets
                the long list at all. */}
            <label style={lbl}>Applies to *</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem' }}>
              <ScopeOption on={form.scope === 'common'} title="Common"
                sub={`Every test that reports ${form.param.trim() || 'this parameter'}`}
                onPick={()=>setForm({ ...form, scope:'common', test_id:'' })} />
              <ScopeOption on={form.scope === 'test'} title="This test only" sub="Pick one test"
                onPick={()=>setForm({ ...form, scope:'test' })} />
            </div>

            {form.scope === 'common' ? (
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.4rem' }}>
                Most ranges are common — written once, used by every test reporting the parameter.
              </div>
            ) : (
              <div style={{ marginTop:'0.7rem', border:'1.5px solid #e8ecf4', borderRadius:'10px',
                            background:'#fff', overflow:'hidden' }}>
                <input style={{ ...inp, border:'none', borderBottom:'1px solid #e8ecf4', borderRadius:0,
                                background:'#fafbfc' }}
                       value={testQ} onChange={e=>setTestQ(e.target.value)}
                       placeholder="🔍  Search tests…" />
                <div style={{ maxHeight:'168px', overflowY:'auto' }}>
                  {tests.filter(t => !testQ.trim() ||
                          (t.name||'').toLowerCase().includes(testQ.trim().toLowerCase()))
                        .map(t => {
                    const on = String(form.test_id) === String(t.id);
                    return (
                      <div key={t.id} onClick={()=>setForm({ ...form, test_id:t.id })}
                           style={{ padding:'0.45rem 0.85rem', fontSize:'0.82rem', cursor:'pointer',
                                    display:'flex', justifyContent:'space-between', alignItems:'center',
                                    background: on ? 'rgba(249,115,22,0.08)' : 'transparent',
                                    color: on ? '#c2410c' : '#0f1218', fontWeight: on ? 700 : 400 }}>
                        <span>{t.name}</span>
                        {/* the price tells two same-named tests apart */}
                        <span style={{ color:'#8892a4', fontWeight:600, fontSize:'0.72rem' }}>
                          {on ? '✓' : inr(t.price)}
                        </span>
                      </div>
                    );
                  })}
                  {tests.filter(t => !testQ.trim() ||
                        (t.name||'').toLowerCase().includes(testQ.trim().toLowerCase())).length === 0 && (
                    <div style={{ padding:'0.7rem 0.85rem', fontSize:'0.8rem', color:'#8892a4' }}>
                      No test matches that.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Editing a shared row reaches further than the person may realise. */}
            {form.id && form.scope === 'common' && (
              <div style={{ fontSize:'0.74rem', color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a',
                            borderRadius:'8px', padding:'0.6rem 0.75rem', marginTop:'0.8rem', lineHeight:1.5 }}>
                ⚠ This is a <b>common</b> range. Saving changes it everywhere {form.param.trim() || 'this parameter'} is
                reported{testsDeclaring(form.param).length
                  ? ` — ${testsDeclaring(form.param).slice(0,3).map(t=>t.name).join(', ')}` +
                    (testsDeclaring(form.param).length > 3 ? ` and ${testsDeclaring(form.param).length - 3} more` : '')
                  : ''}, and any other test reporting it.
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.9rem',
                          marginTop:'1rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Patient Group</label>
                <select style={inp} value={form.sex} onChange={e=>setForm({ ...form, sex:e.target.value })}>
                  <option value="A">Any</option><option value="M">Male</option><option value="F">Female</option>
                  <option value="C">Children</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Age from (years)</label>
                <input style={inp} type="number" value={form.age_min}
                       onChange={e=>setForm({ ...form, age_min:e.target.value })} placeholder="any" />
              </div>
              <div>
                <label style={lbl}>Age to (years)</label>
                <input style={inp} type="number" value={form.age_max}
                       onChange={e=>setForm({ ...form, age_max:e.target.value })} placeholder="any" />
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'0.3rem' }}>
              <div>
                <label style={lbl}>Age from (months)</label>
                <input style={inp} type="number" value={form.age_min_months}
                       onChange={e=>setForm({ ...form, age_min_months:e.target.value })} placeholder="—" />
              </div>
              <div>
                <label style={lbl}>Age to (months)</label>
                <input style={inp} type="number" value={form.age_max_months}
                       onChange={e=>setForm({ ...form, age_max_months:e.target.value })} placeholder="—" />
              </div>
            </div>
            <div style={{ fontSize:'0.72rem', color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a',
                          borderRadius:'8px', padding:'0.5rem 0.7rem', marginBottom:'1rem', lineHeight:1.5 }}>
              For infants. Patient registration records age in whole years at the moment, so a month band
              will not match anyone until age in months is captured — leave these blank for now and use the
              year fields above.
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Low</label>
                <input style={inp} type="number" step="any" value={form.low}
                       onChange={e=>setForm({ ...form, low:e.target.value })} placeholder="e.g. 12" />
              </div>
              <div>
                <label style={lbl}>High</label>
                <input style={inp} type="number" step="any" value={form.high}
                       onChange={e=>setForm({ ...form, high:e.target.value })} placeholder="e.g. 15" />
              </div>
              <div>
                <label style={lbl}>Unit</label>
                <input style={inp} value={form.unit}
                       onChange={e=>setForm({ ...form, unit:e.target.value })} placeholder="keep analyser's" />
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Critical low</label>
                <input style={inp} type="number" step="any" value={form.critical_low}
                       onChange={e=>setForm({ ...form, critical_low:e.target.value })} placeholder="optional" />
              </div>
              <div>
                <label style={lbl}>Critical high</label>
                <input style={inp} type="number" step="any" value={form.critical_high}
                       onChange={e=>setForm({ ...form, critical_high:e.target.value })} placeholder="optional" />
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Method (optional)</label>
                <input style={inp} value={form.method}
                       onChange={e=>setForm({ ...form, method:e.target.value })} placeholder='e.g. "Impedance"' />
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                  Printed under METHODOLOGY. Leave the range blank to set only the method.
                </div>
              </div>
              <div>
                <label style={lbl}>Analyser</label>
                <select style={inp} value={form.device_id}
                        onChange={e=>setForm({ ...form, device_id:e.target.value })}>
                  <option value="">Any analyser</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                  Pick one where two machines report this parameter by different techniques.
                </div>
              </div>
            </div>

            <div style={{ marginBottom:'0.9rem' }}>
              <label style={lbl}>Text range</label>
              <input style={inp} value={form.text}
                     onChange={e=>setForm({ ...form, text:e.target.value })} placeholder='e.g. "Negative"' />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                For results that aren't a number. Printed instead of low–high when filled.
              </div>
            </div>

            <label style={{ display:'flex', alignItems:'center', gap:'0.55rem', cursor:'pointer', marginBottom:'1.4rem', fontSize:'0.85rem', fontWeight:700, color:'#0f1218' }}>
              <input type="checkbox" checked={form.is_active !== false}
                     onChange={e=>setForm({ ...form, is_active:e.target.checked })}
                     style={{ width:'16px', height:'16px', accentColor:'#f97316' }} />
              Active
              <span style={{ fontSize:'0.72rem', fontWeight:500, color:'#8892a4' }}>
                Untick to keep this range but stop using it on reports.
              </span>
            </label>

            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setForm(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':(form.id?'Save changes':'Add Range')}</button>
            </div>
          </div>
        </div>
      )}

      {/* A common row being narrowed to one test: copying keeps every other
          test covered, moving does not. Asking costs one click and saves a
          silent regression on reports nobody was looking at. */}
      {ask && (
        <div onClick={()=>setAsk(null)} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'460px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.1rem', fontWeight:800, color:'#0f1218', marginBottom:'0.45rem' }}>
              Make this specific to one test?
            </div>
            <div style={{ fontSize:'0.84rem', color:'#8892a4', lineHeight:1.55, marginBottom:'1.1rem' }}>
              {ask.param} · {SEX_LABEL[(ask.sex||'A').toUpperCase()]} · {ageText(ask)} is currently a common range.
            </div>
            {[['copy', `Add an override for ${testName(Number(ask.test_id)) || 'this test'}`,
                       'The common range stays for every other test. Recommended.'],
              ['move', 'Move it — remove the common range',
                       'Other tests fall back to whatever the analyser sent.']].map(([m, t, s]) => (
              <div key={m} onClick={()=>setAsk({ ...ask, mode:m })}
                   style={{ border:`1.5px solid ${(ask.mode||'copy')===m ? '#f97316' : '#e8ecf4'}`,
                            background:(ask.mode||'copy')===m ? 'rgba(249,115,22,0.05)' : '#fff',
                            borderRadius:'11px', padding:'0.75rem 0.85rem', marginBottom:'0.55rem', cursor:'pointer' }}>
                <div style={{ fontSize:'0.84rem', fontWeight:700 }}>{t}</div>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.2rem', lineHeight:1.4 }}>{s}</div>
              </div>
            ))}
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end', marginTop:'1rem' }}>
              <button onClick={()=>setAsk(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button disabled={saving}
                onClick={()=>(ask.mode||'copy') === 'copy'
                  ? persist(null, payloadOf(ask), 'Override added for this test')
                  : persist(ask.id, payloadOf(ask), 'Range moved to this test')}
                style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameter list — optional. Says which names are one parameter (WBC / TLC /
// White Blood Cells), the heading each prints under and its order. Left empty,
// nothing in the app changes.
// ─────────────────────────────────────────────────────────────────────────────
const BLANK_PARAM = { name:'', section:'', sort_order:'', aliases:'', is_active:true };

function ParameterList({ showToast }) {
  const [rows, setRows]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => authedFetch('/catalog/parameters')
    .then(r => r.ok ? r.json() : [])
    .then(d => { setRows(Array.isArray(d) ? d : []); setLoad(false); })
    .catch(() => setLoad(false));
  useEffect(() => { load(); }, []);

  const q = search.trim().toLowerCase();
  const shown = rows.filter(r => !q ||
    [r.name, r.section, r.aliases].some(v => (v || '').toLowerCase().includes(q)));

  const save = async () => {
    if (!form.name.trim()) { showToast('error', 'Parameter is required'); return; }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), section: form.section.trim() || null,
                     sort_order: form.sort_order === '' ? null : Number(form.sort_order),
                     aliases: form.aliases.trim() || null, is_active: form.is_active !== false };
      const res = await authedFetch(form.id ? `/catalog/parameters/${form.id}` : '/catalog/parameters',
        { method: form.id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!res.ok) {
        let msg = 'Save failed';
        try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail; } catch {}
        showToast('error', msg); return;
      }
      setForm(null); load(); showToast('success', form.id ? 'Parameter updated' : 'Parameter added');
    } catch { showToast('error', 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div style={{ ...S.card, marginBottom:'1.2rem', padding:'1rem 1.5rem', display:'flex', gap:'0.8rem', alignItems:'center', flexWrap:'wrap' }}>
        <input style={{ ...inp, maxWidth:'320px' }} placeholder="Search parameter, section or alias…"
               value={search} onChange={e=>setSearch(e.target.value)} />
        <div style={{ flex:1 }} />
        <ExcelBar kind="parameters" noun="Parameters" showToast={showToast} onDone={load} />
        <button onClick={()=>setForm({ ...BLANK_PARAM })}
                style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.7rem 1.3rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>+ Add Parameter</button>
      </div>

      <div style={{ ...S.card, marginBottom:'1.2rem', padding:'0.9rem 1.2rem', background:'#fffbeb', border:'1px solid #fde68a', color:'#92400e', fontSize:'0.8rem', lineHeight:1.6 }}>
        Optional. Give a parameter its other names (<b>aliases</b>) and a result that arrives under any of them
        is treated as that parameter, so it finds the same reference range. The <b>section</b> and <b>order</b>
        decide the heading and position on the report. A name or alias can belong to one parameter only.
      </div>

      {loading ? (
        <div style={{ ...S.card, textAlign:'center', color:'#8892a4', padding:'2.5rem' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...S.card, textAlign:'center', color:'#8892a4', padding:'2.5rem' }}>
          {rows.length === 0 ? 'No parameters yet — everything works by the names analysers send.' : 'Nothing matches that search.'}
        </div>
      ) : (
        <div style={{ ...S.card, padding:'0.4rem 1.2rem' }}>
          {shown.map(r => (
            <div key={r.id} onClick={()=>setForm({ id:r.id, name:r.name || '', section:r.section || '',
                    sort_order: r.sort_order ?? '', aliases:r.aliases || '', is_active:r.is_active !== false })}
                 style={{ display:'flex', gap:'0.8rem', alignItems:'center', padding:'0.75rem 0', borderBottom:'1px solid #f0f2f7', cursor:'pointer', opacity: r.is_active === false ? 0.5 : 1 }}>
              <span style={{ width:'34px', color:'#8892a4', fontSize:'0.78rem' }}>{r.sort_order ?? '—'}</span>
              <span style={{ fontWeight:700, minWidth:'170px' }}>{r.name}</span>
              <span style={{ ...PILL_TEST, visibility: r.section ? 'visible' : 'hidden' }}>{r.section || '-'}</span>
              <span style={{ flex:1, color:'#8892a4', fontSize:'0.8rem' }}>{r.aliases || ''}</span>
              {r.is_active === false && <span style={{ ...PILL, background:'#f3f4f6', color:'#6b7280', border:'1px solid #e5e7eb' }}>Inactive</span>}
            </div>
          ))}
        </div>
      )}

      {form && (
        <div onClick={()=>setForm(null)} style={{ position:'fixed', inset:0, zIndex:9997, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem', overflowY:'auto' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'560px', maxWidth:'95vw', maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontSize:'1.2rem', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem' }}>
              {form.id ? 'Edit parameter' : 'Add parameter'}
            </div>

            <div style={{ marginBottom:'0.9rem' }}>
              <label style={lbl}>Parameter *</label>
              <input style={inp} value={form.name} placeholder="WBC, Hemoglobin, Neutrophils %…"
                     onChange={e=>setForm({ ...form, name:e.target.value })} />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
              <div>
                <label style={lbl}>Section</label>
                <input style={inp} value={form.section} placeholder="RBC, WBC, PLATELETS…"
                       onChange={e=>setForm({ ...form, section:e.target.value })} />
              </div>
              <div>
                <label style={lbl}>Order</label>
                <input style={inp} type="number" value={form.sort_order}
                       onChange={e=>setForm({ ...form, sort_order:e.target.value })} />
              </div>
            </div>
            <div style={{ fontSize:'0.72rem', color:'#8892a4', margin:'-0.5rem 0 0.9rem' }}>
              Section is the heading it prints under. Order is its position in the report; blank goes last.
            </div>

            <div style={{ marginBottom:'0.9rem' }}>
              <label style={lbl}>Aliases</label>
              <input style={inp} value={form.aliases} placeholder="TLC, White Blood Cells, Total Leucocyte Count"
                     onChange={e=>setForm({ ...form, aliases:e.target.value })} />
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                Other names for the same parameter, separated by commas.
              </div>
            </div>

            <label style={{ display:'flex', alignItems:'center', gap:'0.55rem', cursor:'pointer', marginBottom:'1.4rem', fontSize:'0.85rem', fontWeight:700, color:'#0f1218' }}>
              <input type="checkbox" checked={form.is_active !== false}
                     onChange={e=>setForm({ ...form, is_active:e.target.checked })}
                     style={{ width:'16px', height:'16px', accentColor:'#f97316' }} />
              Active
              <span style={{ fontSize:'0.72rem', fontWeight:500, color:'#8892a4' }}>
                Untick to keep this parameter but stop using it.
              </span>
            </label>

            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setForm(null)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving?'Saving…':(form.id?'Save changes':'Add Parameter')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
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
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
          <ExcelBar kind="test-groups" noun="Test Groups" showToast={showToast} onDone={load} />
          <button onClick={openNew} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.6rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>+ New Test Group</button>
        </div>
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
