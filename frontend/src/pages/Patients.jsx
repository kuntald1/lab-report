import { useEffect, useState } from 'react';
import { authedFetch, auth } from '../services/auth';

const statusColor = { collected:'#0ea5e9', dispatched:'#6366f1', received:'#8b5cf6', tested:'#f59e0b', validated:'#16a34a', reported:'#0f766e' };

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', transition:'border 0.15s' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const sampleColor = { Blood:'#fff1ee', Serum:'#eff6ff', Urine:'#fefce8', Plasma:'#fdf4ff', Sodium:'#f0fdf4', Potassium:'#fef9c3', Electrolyte:'#f0fdf4' };
const sampleText  = { Blood:'#c2410c', Serum:'#1d4ed8', Urine:'#854d0e', Plasma:'#7e22ce', Sodium:'#16a34a', Potassium:'#854d0e', Electrolyte:'#16a34a' };

// the five quick-history flags captured at registration
const HISTORY_ITEMS = [
  { key:'diabetic',     label:'Diabetic?' },
  { key:'fasting',      label:'Fasting sample?' },
  { key:'on_medication',label:'On medication?' },
  { key:'pregnant',     label:'Pregnant?' },
  { key:'hypertension', label:'Hypertension?' },
];

const BLANK = { patient_name:'', age:'', gender:'Male', doctor_name:'', sample_type:'Blood', barcode:'', abha_number:'', phone:'', branch_id:'', registered_franchise_id:'', organization_id:'', clinical_history:'', history_checklist:{} };

// pretty-print a 14-digit ABHA as XX-XXXX-XXXX-XXXX
const fmtAbha = (n) => {
  if (!n) return '—';
  const d = String(n).replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6,10)}-${d.slice(10)}` : d;
};

export default function Patients({ onBill = () => {} }) {
  const [patients, setPatients]   = useState([]);
  const [branches, setBranches]   = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editingId, setEditingId] = useState(null);   // null = create mode
  const [form, setForm]           = useState(BLANK);
  const [doctors, setDoctors]     = useState([]);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm]     = useState({ full_name:'', email:'', password:'' });
  const [docSaving, setDocSaving] = useState(false);

  // logged-in user — a franchise user is locked to their own franchise
  const me              = auth.user();
  const myRole          = (me?.role || '').toLowerCase();
  const isFranchiseUser = myRole === 'franchise';
  const isAdminUser     = ['super_admin','lab_admin'].includes(myRole);
  const myFranchiseId   = me?.franchise_id ?? '';

  const loadDoctors = () => authedFetch('/admin/users')
    .then(r=>r.ok?r.json():[])
    .then(us => setDoctors(us.filter(u => (u.role||'').toLowerCase() === 'pathologist')))
    .catch(()=>{});

  const load = () => authedFetch('/patients/').then(r=>r.json()).then(setPatients).catch(()=>{});
  useEffect(() => {
    load();
    loadDoctors();
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
    authedFetch('/admin/franchises').then(r=>r.ok?r.json():[]).then(setFranchises).catch(()=>{});
  }, []);

  const docName = (u) => u.full_name || u.email;

  const createDoctor = async () => {
    if (!docForm.full_name || !docForm.email || !docForm.password) return alert('All fields required');
    setDocSaving(true);
    try {
      const res = await authedFetch('/admin/users', { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...docForm, role:'pathologist' }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      await loadDoctors();
      setForm(f => ({ ...f, doctor_name: docForm.full_name }));   // auto-select the new doctor
      setShowDocModal(false); setDocForm({ full_name:'', email:'', password:'' });
    } catch (err) { alert('Could not add doctor: ' + err.message); }
    setDocSaving(false);
  };

  const branchName    = (id) => branches.find(b=>b.id===id)?.name || (id ? `Branch ${id}` : '—');
  const franchiseName = (id) => franchises.find(f=>f.id===id)?.name || (id ? `Franchise ${id}` : '—');

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...BLANK, history_checklist:{},
      registered_franchise_id: isFranchiseUser ? String(myFranchiseId) : '',
      organization_id:         isFranchiseUser ? String(myFranchiseId) : '' });
    setShowForm(true);
  };
  const startEdit  = (p) => {
    setEditingId(p.id);
    setForm({
      patient_name: p.patient_name || '', age: p.age ?? '', gender: p.gender || 'Male',
      doctor_name: p.doctor_name || '', sample_type: p.sample_type || 'Blood', barcode: p.barcode || '',
      abha_number: p.abha_number || '',
      phone: p.phone || '',
      branch_id: p.branch_id ?? '', registered_franchise_id: p.registered_franchise_id ?? '',
      organization_id: p.organization_id ?? '',
      clinical_history: p.clinical_history || '',
      history_checklist: p.history_checklist || {},
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (thenBill = false) => {
    if (!form.patient_name) return alert('Patient name required');
    setSaving(true);
    // only send the checklist if anything was ticked; keep note as-is
    const checklist = Object.fromEntries(
      Object.entries(form.history_checklist || {}).filter(([, v]) => v));
    const payload = {
      patient_name: form.patient_name,
      age: form.age ? parseInt(form.age) : null,
      gender: form.gender,
      doctor_name: form.doctor_name || null,
      sample_type: form.sample_type,
      abha_number: form.abha_number || null,
      phone: form.phone || null,
      branch_id: form.branch_id ? parseInt(form.branch_id) : null,
      registered_franchise_id: form.registered_franchise_id ? parseInt(form.registered_franchise_id) : null,
      organization_id: form.organization_id ? parseInt(form.organization_id) : null,
      clinical_history: form.clinical_history || null,
      history_checklist: Object.keys(checklist).length ? checklist : null,
    };
    try {
      if (editingId) {
        await authedFetch(`/patients/${editingId}`, { method:'PUT',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      } else {
        const res = await authedFetch('/patients/', { method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ...payload, barcode: form.barcode || undefined }) });
        if (!res.ok) throw new Error('save failed');
        const created = await res.json();          // has the new patient id
        setForm(BLANK); setEditingId(null); setShowForm(false); setSaving(false);
        load();
        if (thenBill && created?.id) onBill(created.id);   // straight into bill + pay
        return;
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

  return (
    <div>
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
            <div><label style={lbl}>Age</label><input style={inp} type="number" placeholder="35" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} /></div>
            <div><label style={lbl}>Gender</label>
              <select style={inp} value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
                <option>Male</option><option>Female</option><option>Other</option>
              </select></div>
            <div><label style={lbl}>Doctor Name</label>
              <div style={{ display:'flex', gap:'0.4rem' }}>
                <select style={{ ...inp, flex:1 }} value={form.doctor_name} onChange={e=>setForm({...form,doctor_name:e.target.value})}>
                  <option value="">— Select doctor —</option>
                  {form.doctor_name && !doctors.some(d=>docName(d)===form.doctor_name) && (
                    <option value={form.doctor_name}>{form.doctor_name}</option>
                  )}
                  {doctors.map(d => <option key={d.id} value={docName(d)}>{docName(d)}</option>)}
                </select>
                {isAdminUser && (
                  <button type="button" title="Add a new doctor" onClick={()=>setShowDocModal(true)}
                    style={{ width:'42px', flexShrink:0, background:'rgba(249,115,22,0.1)', color:'#f97316', border:'1.5px solid rgba(249,115,22,0.35)', borderRadius:'9px', fontSize:'1.2rem', fontWeight:700, cursor:'pointer', lineHeight:1 }}>+</button>
                )}
              </div>
            </div>
            <div><label style={lbl}>ABHA Number <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(14-digit health ID)</span></label>
              <input style={{ ...inp, fontFamily:'monospace', letterSpacing:'0.04em' }} placeholder="e.g. 91-1234-5678-9012" value={form.abha_number} onChange={e=>setForm({...form,abha_number:e.target.value})} /></div>
            <div><label style={lbl}>Phone <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(for WhatsApp bill)</span></label>
              <input style={inp} placeholder="10-digit mobile" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
            <div><label style={lbl}>Branch {(isFranchiseUser || form.registered_franchise_id) && <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400, color:'#c2410c' }}>(locked — set by franchise)</span>}</label>
              <select
                style={(isFranchiseUser || form.registered_franchise_id) ? { ...inp, background:'#f1f3f7', color:'#94a3b8', cursor:'not-allowed' } : inp}
                value={form.branch_id}
                disabled={isFranchiseUser || !!form.registered_franchise_id}
                onChange={e=>setForm({...form,branch_id:e.target.value})}>
                <option value="">— Use my branch —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div><label style={lbl}>Franchise <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(also used for B2B billing)</span></label>
              {isFranchiseUser ? (
                <select style={{ ...inp, background:'#f1f3f7', color:'#475569', cursor:'not-allowed' }} value={String(myFranchiseId)} disabled>
                  <option value={String(myFranchiseId)}>{franchiseName(Number(myFranchiseId))}</option>
                </select>
              ) : (
                <select style={inp} value={form.registered_franchise_id} onChange={e=>{ const v=e.target.value; setForm({...form, registered_franchise_id:v, organization_id:v, branch_id: v ? '' : form.branch_id }); }}>
                  <option value="">— Direct / Walk-in —</option>
                  {franchises.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
            </div>
            {!editingId && (
              <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Barcode <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(leave blank to auto-generate)</span></label>
                <input style={{ ...inp, fontFamily:'monospace', letterSpacing:'0.04em' }} placeholder="e.g. MC45265601" value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} /></div>
            )}
            {editingId && (
              <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Barcode</label>
                <input style={{ ...inp, fontFamily:'monospace', background:'#f1f3f7', color:'#8892a4' }} value={form.barcode} disabled /></div>
            )}
          </div>

          {/* --- Patient history (captured at registration) --- */}
          <div style={{ background:'#fffaf3', border:'1px solid rgba(249,115,22,0.25)', borderRadius:'12px', padding:'1.1rem 1.2rem', marginBottom:'1rem' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#c2410c', fontSize:'0.9rem', marginBottom:'0.8rem' }}>Patient History</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem 1.5rem', marginBottom:'0.9rem' }}>
              {HISTORY_ITEMS.map(it => (
                <label key={it.key} style={{ display:'flex', alignItems:'center', gap:'0.55rem', cursor:'pointer', fontSize:'0.85rem', color:'#0f1218' }}>
                  <input type="checkbox"
                    checked={!!form.history_checklist?.[it.key]}
                    onChange={e=>setForm({...form, history_checklist:{...form.history_checklist, [it.key]:e.target.checked}})}
                    style={{ width:'16px', height:'16px', accentColor:'#f97316', cursor:'pointer' }} />
                  {it.label}
                </label>
              ))}
            </div>
            <label style={lbl}>Note <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(optional)</span></label>
            <textarea style={{ ...inp, minHeight:'64px', resize:'vertical', fontFamily:'Manrope,sans-serif' }}
              placeholder="e.g. Confirm last meal time and any thyroid medication"
              value={form.clinical_history}
              onChange={e=>setForm({...form, clinical_history:e.target.value})} />
          </div>

          {!editingId && (
            <div style={{ fontSize:'0.75rem', color:'#8892a4', marginBottom:'1rem' }}>
              {form.barcode ? <span style={{ color:'#f97316', fontWeight:600 }}>✅ Custom barcode: {form.barcode}</span> : 'Barcode will be auto-generated by the system.'}
            </div>
          )}
          <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap' }}>
            {editingId ? (
              <button onClick={()=>submit(false)} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>
                {saving ? 'Saving...' : 'Update Patient'}
              </button>
            ) : (
              <>
                <button onClick={()=>submit(true)} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  {saving ? 'Saving...' : 'Register & Bill →'}
                </button>
                <button onClick={()=>submit(false)} disabled={saving} style={{ background:'#fff', color:'#f97316', border:'1.5px solid rgba(249,115,22,0.4)', borderRadius:'9px', padding:'0.65rem 1.3rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
                  Register only
                </button>
              </>
            )}
            <button onClick={()=>{ setShowForm(false); setEditingId(null); setForm(BLANK); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      {showDocModal && (
        <div onClick={()=>setShowDocModal(false)} style={{ position:'fixed', inset:0, background:'rgba(15,18,24,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div onClick={e=>e.stopPropagation()} style={{ ...S.card, width:'440px', maxWidth:'92vw', border:'1px solid rgba(249,115,22,0.3)' }}>
            <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.1rem', fontSize:'1rem' }}>Add New Doctor</div>
            <div style={{ display:'grid', gap:'0.85rem' }}>
              <div><label style={lbl}>Full Name *</label><input style={inp} placeholder="Dr. A. Sharma" value={docForm.full_name} onChange={e=>setDocForm({...docForm,full_name:e.target.value})} /></div>
              <div><label style={lbl}>Email (Login ID) *</label><input style={inp} placeholder="doctor@lab.com" value={docForm.email} onChange={e=>setDocForm({...docForm,email:e.target.value})} /></div>
              <div><label style={lbl}>Password *</label><input style={inp} type="password" placeholder="set a password" value={docForm.password} onChange={e=>setDocForm({...docForm,password:e.target.value})} /></div>
              <div><label style={lbl}>Role</label>
                <input style={{ ...inp, background:'#f1f3f7', color:'#475569', cursor:'not-allowed' }} value="Doctor (Pathologist)" disabled readOnly /></div>
            </div>
            <div style={{ display:'flex', gap:'0.6rem', marginTop:'1.2rem' }}>
              <button onClick={createDoctor} disabled={docSaving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.4rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>{docSaving ? 'Adding…' : 'Add Doctor'}</button>
              <button onClick={()=>setShowDocModal(false)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Patient Name','Age','Gender','Doctor','ABHA','Sample','Status','Registered','Actions'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>
                <div style={{ fontSize:'2rem', marginBottom:'0.8rem' }}>👤</div>
                No patients registered yet.
              </td></tr>
            )}
            {patients.map(p => (
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
                  <span style={{ background:sampleColor[p.sample_type]||'#f5f5f5', color:sampleText[p.sample_type]||'#333', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>{p.sample_type}</span>
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
