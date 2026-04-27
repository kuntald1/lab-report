import { useEffect, useState } from 'react';
import { api } from '../services/api';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', transition:'border 0.15s' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };

const sampleColor = { Blood:'#fff1ee', Serum:'#eff6ff', Urine:'#fefce8', Plasma:'#fdf4ff' };
const sampleText  = { Blood:'#c2410c', Serum:'#1d4ed8', Urine:'#854d0e', Plasma:'#7e22ce' };

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ patient_name:'', age:'', gender:'Male', doctor_name:'', sample_type:'Blood', barcode:'' });

  const load = () => api.getPatients().then(setPatients).catch(()=>{});
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if(!form.patient_name) return alert('Patient name required');
    setSaving(true);
    await api.createPatient({ ...form, age: form.age ? parseInt(form.age) : null, barcode: form.barcode || undefined });
    setForm({ patient_name:'', age:'', gender:'Male', doctor_name:'', sample_type:'Blood', barcode:'' });
    setShowForm(false);
    load();
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem' }}>
        <div>
          <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Registry</div>
          <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Patients</h1>
          <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{patients.length} registered patients</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.65rem 1.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
          + Add Patient
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:'1.5rem', border:'1px solid rgba(249,115,22,0.2)' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.2rem', fontSize:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ width:'28px', height:'28px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem' }}>👤</span>
            Register New Patient
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'1rem' }}>
            <div><label style={lbl}>Patient Name *</label><input style={inp} placeholder="Full Name" value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})} /></div>
            <div><label style={lbl}>Age</label><input style={inp} type="number" placeholder="35" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} /></div>
            <div><label style={lbl}>Gender</label>
              <select style={inp} value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
                <option>Male</option><option>Female</option><option>Other</option>
              </select></div>
            <div><label style={lbl}>Doctor Name</label><input style={inp} placeholder="Dr. Sharma" value={form.doctor_name} onChange={e=>setForm({...form,doctor_name:e.target.value})} /></div>
            <div><label style={lbl}>Sample Type</label>
              <select style={inp} value={form.sample_type} onChange={e=>setForm({...form,sample_type:e.target.value})}>
                <option>Blood</option><option>Serum</option><option>Urine</option><option>Plasma</option>
              </select></div>
            <div><label style={lbl}>Barcode <span style={{ textTransform:'none', letterSpacing:0, fontWeight:400 }}>(leave blank to auto-generate)</span></label>
              <input style={{ ...inp, fontFamily:'monospace', letterSpacing:'0.04em' }} placeholder="e.g. MC45265601" value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} /></div>
          </div>
          <div style={{ fontSize:'0.75rem', color:'#8892a4', marginBottom:'1rem' }}>
            {form.barcode ? <span style={{ color:'#f97316', fontWeight:600 }}>✅ Custom barcode: {form.barcode}</span> : 'Barcode will be auto-generated by the system.'}
          </div>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button onClick={submit} disabled={saving} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.65rem 1.5rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 14px rgba(249,115,22,0.3)' }}>
              {saving ? 'Saving...' : 'Register Patient'}
            </button>
            <button onClick={()=>setShowForm(false)} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
              {['Barcode','Patient Name','Age','Gender','Doctor','Sample','Registered'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'0.8rem 1.3rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem', color:'#8892a4' }}>
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
                <td style={{ padding:'0.9rem 1.3rem' }}>
                  <span style={{ background:sampleColor[p.sample_type]||'#f5f5f5', color:sampleText[p.sample_type]||'#333', padding:'0.2rem 0.7rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:700 }}>{p.sample_type}</span>
                </td>
                <td style={{ padding:'0.9rem 1.3rem', color:'#8892a4', fontSize:'0.78rem' }}>{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
