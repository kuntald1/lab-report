import { useEffect, useState } from 'react';
import { authedFetch, auth } from '../services/auth';

const statusColor = { collected:'#0ea5e9', dispatched:'#6366f1', received:'#8b5cf6', tested:'#f59e0b', validated:'#16a34a', reported:'#0f766e' };

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', transition:'border 0.15s' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const sampleColor = { Blood:'#fff1ee', Serum:'#eff6ff', Urine:'#fefce8', Plasma:'#fdf4ff', Sodium:'#f0fdf4', Potassium:'#fef9c3', Electrolyte:'#f0fdf4' };
const sampleText  = { Blood:'#c2410c', Serum:'#1d4ed8', Urine:'#854d0e', Plasma:'#7e22ce', Sodium:'#16a34a', Potassium:'#854d0e', Electrolyte:'#16a34a' };

const BLANK = { patient_name:'', age:'', gender:'Male', doctor_name:'', referral_doctor_id:null, barcode:'', abha_number:'', phone:'', branch_id:'', registered_franchise_id:'', organization_id:'', checklist:{diabetic:false,on_medication:false,hypertension:false,fasting_sample:false,pregnant:false}, note:'' };

// pretty-print a 14-digit ABHA as XX-XXXX-XXXX-XXXX
const fmtAbha = (n) => {
  if (!n) return '—';
  const d = String(n).replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6,10)}-${d.slice(10)}` : d;
};

export default function Patients({ onBill = () => {} }) {
  const me = auth.user();
  const role = (me?.role || '').toLowerCase();
  const isFranchise = role === 'franchise';
  const [patients, setPatients]   = useState([]);
  const [branches, setBranches]   = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [refDoctors, setRefDoctors] = useState([]);  // referral doctors
  const [addingDoctor, setAddingDoctor] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [branchWarning, setBranchWarning] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editingId, setEditingId] = useState(null);   // null = create mode
  const [form, setForm]           = useState(BLANK);
  const [search, setSearch]       = useState('');

  const load = () => authedFetch('/patients/').then(r=>r.json()).then(setPatients).catch(()=>{});
  useEffect(() => {
    load();
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
    authedFetch('/admin/franchises').then(r=>r.ok?r.json():[]).then(setFranchises).catch(()=>{});
    authedFetch('/b2b/referral-doctors').then(r=>r.ok?r.json():[]).then(setRefDoctors).catch(()=>{});
  }, []);

  const branchName    = (id) => branches.find(b=>b.id===id)?.name || (id ? `Branch ${id}` : '—');
  const franchiseName = (id) => franchises.find(f=>f.id===id)?.name || (id ? `Franchise ${id}` : '—');

  const filteredPatients = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(p =>
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.patient_name || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q)
    );
  })();

  const openCreate = () => {
    setEditingId(null);
    setBranchWarning(false);
    const blank = {...BLANK};
    if (isFranchise && me?.franchise_id) {
      blank.registered_franchise_id = String(me.franchise_id);
      blank.organization_id = String(me.franchise_id);
    }
    setForm(blank);
    setShowForm(true);
  };
  const startEdit  = (p) => {
    setEditingId(p.id);
    setBranchWarning(false);
    setForm({
      patient_name: p.patient_name || '', age: p.age ?? '', gender: p.gender || 'Male',
      doctor_name: p.doctor_name || '', referral_doctor_id: p.referral_doctor_id ?? null, barcode: p.barcode || '',
      abha_number: p.abha_number || '',
      phone: p.phone || '',
      branch_id: p.branch_id ?? '', registered_franchise_id: p.registered_franchise_id ?? '',
      organization_id: p.organization_id ?? '',
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    if (!form.patient_name) return alert('Patient name required');
    if (!form.age) return alert('Age is required');
    // Franchise-role users have Branch/Franchise locked to their own
    // franchise automatically, so this only applies to lab-side staff who
    // can actually pick either field.
    if (!isFranchise && !form.branch_id && !form.registered_franchise_id) {
      setBranchWarning(true);
      document.getElementById('branch-franchise-row')?.scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }
    setBranchWarning(false);
    setSaving(true);
    const payload = {
      patient_name: form.patient_name,
      age: form.age ? parseInt(form.age) : null,
      gender: form.gender,
      doctor_name: form.doctor_name || null,
      referral_doctor_id: form.referral_doctor_id || null,
      checklist: form.checklist || null,
      note: form.note || null,
      abha_number: form.abha_number || null,
      phone: form.phone || null,
      branch_id: form.branch_id ? parseInt(form.branch_id) : null,
      registered_franchise_id: form.registered_franchise_id ? parseInt(form.registered_franchise_id) : null,
      organization_id: form.organization_id ? parseInt(form.organization_id) : null,
    };
    try {
      if (editingId) {
        await authedFetch(`/patients/${editingId}`, { method:'PUT',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      } else {
        const res = await authedFetch('/patients/', { method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ...payload, barcode: form.barcode || undefined }) });
        if (res.ok) { const created = await res.json(); setForm(BLANK); setEditingId(null); setShowForm(false); load(); setSaving(false); return created; }
      }
      setForm(BLANK); setEditingId(null); setShowForm(false);
      load();
    } catch { alert('Save failed'); }
    setSaving(false);
  };

  const remove = async (p) => {
    if (!window.confirm(`Archive patient "${p.patient_name}" (${p.barcode})?\nThis hides the record but keeps it for history.`)) return;
    await authedFetch(`/patients/${p.id}`, { method:'DELETE' });
    load();
  };

  // quick-add doctor handler
  const saveNewDoctor = async () => {
    if (!newDocName.trim()) return;
    try {
      const res = await authedFetch('/b2b/referral-doctors', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: newDocName.trim(), phone:'', commission_percent:0 }) });
      if (!res.ok) throw new Error();
      const doc = await res.json();
      setRefDoctors(prev=>[...prev, doc]);
      setForm(f=>({...f, doctor_name: doc.name, referral_doctor_id: doc.id}));
      setAddingDoctor(false);
    } catch { alert('Failed to add doctor'); }
  };

  return (
    <div>
      {addingDoctor && (
        <div onClick={()=>setAddingDoctor(false)} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px', padding:'1.8rem', width:'380px', maxWidth:'92vw', boxShadow:'0 20px 60px rgba(15,18,24,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1.1rem', color:'#0f1218', marginBottom:'1rem' }}>Add Referral Doctor</div>
            <p style={{ fontSize:'0.8rem', color:'#8892a4', marginBottom:'1rem', marginTop:0 }}>Just a name — no login credentials needed. Set commission % later in the Doctors master.</p>
            <label style={lbl}>Doctor Name *</label>
            <input autoFocus style={{ ...inp, marginBottom:'1.2rem' }} placeholder="Dr. A. Sharma" value={newDocName} onChange={e=>setNewDocName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveNewDoctor()} />
            <div style={{ display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
              <button onClick={()=>setAddingDoctor(false)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'10px', padding:'0.65rem 1.3rem', cursor:'pointer', fontWeight:600, fontFamily:'Manrope,sans-serif' }}>Cancel</button>
              <button onClick={saveNewDoctor} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.6rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>Add Doctor</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Registry</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Patients</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{patients.length} registered patients</p>
        </div>
        <button onClick={openCreate} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
          + Add Patient
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ width:'28px', height:'28px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem' }}>👤</span>
            {editingId ? 'Edit Patient' : 'Register New Patient'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Patient Name *</label><input style={inp} placeholder="Full Name" value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})} /></div>
            <div><label style={lbl}>Age *</label><input style={inp} type="number" placeholder="35" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} /></div>
            <div><label style={lbl}>Gender</label>
              <select style={inp} value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
                <option>Male</option><option>Female</option><option>Other</option>
              </select></div>
            <div>
              <label style={lbl}>Doctor Name {form.referral_doctor_id && <span style={{ color:'#16a34a', fontWeight:700, textTransform:'none' }}>✓ Registered</span>}</label>
              <div style={{ display:'flex', gap:'0.4rem', alignItems:'stretch' }}>
                <select style={{ ...inp, flex:1 }} value={form.doctor_name} onChange={e=>{
                  const name = e.target.value;
                  const match = refDoctors.find(d=>d.name===name);
                  setForm({...form, doctor_name:name, referral_doctor_id: match ? match.id : null});
                }}>
                  <option value="">— Select or type below —</option>
                  {refDoctors.map(d=><option key={d.id} value={d.name}>{d.has_login ? '🩺 ' : ''}{d.name}</option>)}
                </select>
                <button type="button" title="Add new doctor" onClick={()=>{ setNewDocName(''); setAddingDoctor(true); }}
                  style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0 0.9rem', fontWeight:800, cursor:'pointer', fontSize:'1.1rem', flexShrink:0 }}>+</button>
              </div>
              {/* free-type names aren't linked to a registered profile, so they won't accrue commission */}
              <input style={{ ...inp, marginTop:'0.3rem', fontSize:'0.78rem', padding:'0.4rem 0.7rem' }} placeholder="or type a name directly (no commission tracking)" value={form.doctor_name} onChange={e=>setForm({...form, doctor_name:e.target.value, referral_doctor_id:null})} />
            </div>
            <div><label style={lbl}>ABHA Number <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(14-digit health ID)</span></label>
              <input style={{ ...inp, fontFamily:'monospace', letterSpacing:'0.04em' }} placeholder="e.g. 91-1234-5678-9012" value={form.abha_number} onChange={e=>setForm({...form,abha_number:e.target.value})} /></div>
            <div><label style={lbl}>Phone <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(for WhatsApp bill)</span></label>
              <input style={inp} placeholder="10-digit mobile" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
            <div id="branch-franchise-row" style={{ gridColumn:'1 / -1', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem' }}>
              <div><label style={lbl}>Branch {isFranchise && <span style={{color:'#f97316',fontWeight:400,textTransform:'none'}}>(locked – set by franchise)</span>}</label>
                <select style={{...inp, background: isFranchise?'#f1f3f7':(branchWarning?'#fff7ed':''), color: isFranchise?'#8892a4':'', border: branchWarning?'1.5px solid #f97316':undefined}} disabled={isFranchise} value={form.branch_id} onChange={e=>{ setForm({...form,branch_id:e.target.value}); setBranchWarning(false); }}>
                  <option value="">— Select branch —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <div><label style={lbl}>Franchise <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(also used for B2B billing)</span></label>
                <select style={{...inp, background: isFranchise?'#f1f3f7':(branchWarning?'#fff7ed':''), color: isFranchise?'#0f1218':'', border: branchWarning?'1.5px solid #f97316':undefined}} disabled={isFranchise} value={isFranchise ? (me?.franchise_id || form.registered_franchise_id) : form.registered_franchise_id} onChange={e=>{ setForm({...form,registered_franchise_id:e.target.value, organization_id:e.target.value}); setBranchWarning(false); }}>
                  <option value="">— Direct / Walk-in —</option>
                  {franchises.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select></div>
              {branchWarning && !isFranchise && (
                <div style={{ gridColumn:'1 / -1', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.3)', borderRadius:'8px', padding:'0.6rem 0.9rem', color:'#c2410c', fontSize:'0.8rem', fontWeight:600 }}>
                  ⚠ Please select either a Branch or a Franchise before saving.
                </div>
              )}
            </div>
            {!editingId && (
              <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Barcode <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(auto-generated · HC + 5 digits)</span></label>
                <input style={{ ...inp, fontFamily:'monospace', letterSpacing:'0.04em', background:'#f1f3f7', color:'#8892a4' }} placeholder="e.g. HC48213" value="Assigned automatically on save" disabled /></div>
            )}
            {editingId && (
              <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Barcode</label>
                <input style={{ ...inp, fontFamily:'monospace', background:'#f1f3f7', color:'#8892a4' }} value={form.barcode} disabled /></div>
            )}
          </div>
          <div style={{ background:'rgba(249,115,22,0.04)', border:'1px solid rgba(249,115,22,0.15)', borderRadius:'12px', padding:'1rem 1.3rem', marginBottom:'1rem' }}>
            <div style={{ fontWeight:800, color:'#f97316', fontSize:'0.82rem', marginBottom:'0.7rem' }}>Patient History</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem 2rem', marginBottom:'0.7rem' }}>
              {[['diabetic','Diabetic?'],['on_medication','On medication?'],['hypertension','Hypertension?'],['fasting_sample','Fasting sample?'],['pregnant','Pregnant?']].map(([k,label])=>(
                <label key={k} style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.83rem', color:'#475569', cursor:'pointer' }}>
                  <input type="checkbox" checked={!!(form.checklist&&form.checklist[k])} onChange={e=>setForm({...form,checklist:{...(form.checklist||{}),[k]:e.target.checked}})} style={{ accentColor:'#f97316', width:'15px', height:'15px' }} />
                  {label}
                </label>
              ))}
            </div>
            <label style={{ ...lbl, display:'block', marginBottom:'0.3rem' }}>Note <span style={{ textTransform:'none', fontWeight:400 }}>(optional)</span></label>
            <textarea style={{ ...inp, resize:'vertical', minHeight:'60px', fontFamily:'Manrope,sans-serif' }} placeholder="e.g. Confirm last meal time and any thyroid medication" value={form.note||''} onChange={e=>setForm({...form,note:e.target.value})} />
          </div>
          {!editingId && (
            <div style={{ fontSize:'0.75rem', color:'#8892a4', marginBottom:'1rem' }}>
              {form.barcode ? <span style={{ color:'#f97316', fontWeight:600 }}>✅ Custom barcode: {form.barcode}</span> : 'Barcode will be auto-generated by the system.'}
            </div>
          )}
          <div style={{ display:'flex', gap:'0.6rem' }}>
            {editingId ? (
              <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>
                {saving ? 'Saving...' : 'Update Patient'}
              </button>
            ) : (<>
              <button onClick={async()=>{ const p=await submit(); if(p) onBill(p.id); }} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>
                {saving ? 'Saving...' : 'Register & Bill →'}
              </button>
              <button onClick={submit} disabled={saving} style={{ background:'transparent', color:'#f97316', border:'2px solid #f97316', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
                {saving ? '...' : 'Register only'}
              </button>
            </>)}
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:'0.9rem 1.1rem', marginBottom:'1.2rem', display:'flex', alignItems:'center', gap:'0.7rem' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search by Barcode, Patient Name, or Phone Number..."
          style={{ ...inp, border:'none', background:'transparent', padding:'0.3rem 0', flex:1 }}
        />
        {search && (
          <button onClick={()=>setSearch('')} title="Clear" style={{ background:'transparent', border:'none', color:'#8892a4', cursor:'pointer', fontSize:'0.8rem', fontWeight:700, padding:'0.2rem 0.5rem' }}>✕</button>
        )}
        {search && (
          <span style={{ fontSize:'0.72rem', color:'#8892a4', whiteSpace:'nowrap' }}>{filteredPatients.length} of {patients.length}</span>
        )}
      </div>

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Patient Name','Age','Gender','Doctor','ABHA','Tests','Status','Registered','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPatients.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>
                <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>👤</div>
                {search ? `No patients match "${search}".` : 'No patients registered yet.'}
              </td></tr>
            )}
            {filteredPatients.map(p => (
              <tr key={p.id} style={{ borderBottom:'1px solid #f4f6fa', transition:'background 0.1s' }}
                onMouseEnter={e=>e.currentTarget.style.background='#fafbfc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:'rgba(249,115,22,0.08)', color:'#f97316', padding:'0.2rem 0.7rem', borderRadius:'5px', fontSize:'0.75rem', fontWeight:700, fontFamily:'monospace', border:'1px solid rgba(249,115,22,0.2)' }}>{p.barcode}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem', fontWeight:700, color:'#0f1218', fontSize:'0.88rem' }}>{p.patient_name}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.85rem' }}>{p.age||'—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.85rem' }}>{p.gender}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.85rem' }}>{p.doctor_name||'—'}</td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#475569', fontSize:'0.78rem', fontFamily:'monospace' }}>{fmtAbha(p.abha_number)}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  {(p.tests_summary && p.tests_summary.length > 0) ? (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.25rem', maxWidth:'220px' }}>
                      {p.tests_summary.slice(0,2).map((t,i) => (
                        <span key={i} style={{ background:'rgba(249,115,22,0.08)', color:'#c2410c', padding:'0.15rem 0.55rem', borderRadius:'20px', fontSize:'0.68rem', fontWeight:600 }}>{t}</span>
                      ))}
                      {p.tests_summary.length > 2 && <span style={{ fontSize:'0.68rem', color:'#8892a4' }}>+{p.tests_summary.length-2} more</span>}
                    </div>
                  ) : <span style={{ color:'#c4cad6', fontSize:'0.78rem' }}>—</span>}
                </td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:(statusColor[p.status]||'#94a3b8')+'22', color:statusColor[p.status]||'#94a3b8', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.7rem', fontWeight:800, textTransform:'capitalize' }}>{p.status||'—'}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.78rem' }}>{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    <button title="Create bill" onClick={()=>onBill(p.id)} style={iconBtn('#16a34a')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>
                    </button>
                    <button title="Edit" onClick={()=>startEdit(p)} style={iconBtn('#2563eb')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title="Archive (soft delete)" onClick={()=>remove(p)} style={iconBtn('#dc2626')}>
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
  return {
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    width:'30px', height:'30px', borderRadius:'8px', cursor:'pointer',
    background:color+'12', color, border:'1px solid '+color+'33',
  };
}
