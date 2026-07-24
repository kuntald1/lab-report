import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%', boxSizing:'border-box' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const sectionTitle = { fontFamily:'Manrope,sans-serif', fontWeight:800, color:'#0f1218', marginBottom:'1.1rem', fontSize:'1rem' };
const hint = { fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem', lineHeight:1.4 };

const BLANK = {
  layout: 'continuous',
  lab_name: '', tagline: '', unit_of: '',
  address_lines: [], phones: [], email: '', website: '',
  logo_filename: null, logo_url: null,
};

export default function ReportSettings() {
  const [form, setForm]       = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);
  const [uploading, setUploading] = useState(null);   // 'logo' | null

  const logoInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    authedFetch('/admin/report-settings')
      .then(r => r.ok ? r.json() : BLANK)
      .then(d => setForm({
        ...BLANK, ...d,
        address_lines: d.address_lines || [],
        phones: d.phones || [],
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        layout: form.layout,
        lab_name: form.lab_name,
        tagline: form.tagline,
        unit_of: form.unit_of,
        address_lines: form.address_lines,
        phones: form.phones,
        email: form.email,
        website: form.website,
      };
      const r = await authedFetch('/admin/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setForm(f => ({ ...f, ...d, address_lines: d.address_lines || [], phones: d.phones || [] }));
      flash('Report settings saved');
    } catch { flash('Save failed', false); }
    setSaving(false);
  };

  const upload = async (kind, file) => {
    if (!file) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const r = await authedFetch('/admin/report-settings/upload', { method: 'POST', body: fd });
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Upload failed'); }
      const d = await r.json();
      setForm(f => ({ ...f, ...d, address_lines: d.address_lines || [], phones: d.phones || [] }));
      flash(`${kind === 'logo' ? 'Logo' : 'Signature'} uploaded`);
    } catch (e) { flash(e.message || 'Upload failed', false); }
    setUploading(null);
  };

  const resetAsset = async (kind) => {
    if (!window.confirm(`Remove the uploaded ${kind} and go back to the default?`)) return;
    setUploading(kind);
    try {
      const r = await authedFetch(`/admin/report-settings/${kind}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setForm(f => ({ ...f, ...d, address_lines: d.address_lines || [], phones: d.phones || [] }));
      flash(`${kind === 'logo' ? 'Logo' : 'Signature'} reset to default`);
    } catch { flash('Reset failed', false); }
    setUploading(null);
  };

  if (loading) return <div style={{ padding:'3rem', textAlign:'center', color:'#8892a4' }}>Loading report settings...</div>;

  return (
    <div>
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Report Settings</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>Letterhead and layout for the official sample report PDF. Each doctor's own signature is set on their profile under <strong>Doctor Commission → Referral Doctors</strong>.</p>
      </div>

      {toast && (
        <div style={{ marginBottom:'1.2rem', padding:'0.7rem 1.1rem', borderRadius:'9px', fontSize:'0.82rem', fontWeight:600, fontFamily:'Manrope,sans-serif',
          background: toast.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
          color:      toast.ok ? '#16a34a' : '#dc2626',
          border: `1px solid ${toast.ok ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}` }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.3rem' }}>

        {/* ── Letterhead ─────────────────────────────────────── */}
        <div style={{ ...S.card, gridColumn:'1 / -1' }}>
          <div style={sectionTitle}>Letterhead</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem', marginBottom:'0.9rem' }}>
            <div><label style={lbl}>Lab Name</label>
              <input style={inp} value={form.lab_name} onChange={e=>set('lab_name', e.target.value)} placeholder="HEALTHYCIAN" /></div>
            <div><label style={lbl}>Tagline</label>
              <input style={inp} value={form.tagline} onChange={e=>set('tagline', e.target.value)} placeholder="Improving Lives With a Smile" /></div>
          </div>
          <div style={{ marginBottom:'0.9rem' }}>
            <label style={lbl}>Unit Of (business/subsidiary name shown in the footer)</label>
            <input style={inp} value={form.unit_of} onChange={e=>set('unit_of', e.target.value)} placeholder="HEALTHNODE BIOSCIENCE PVT.LTD" />
          </div>
          <div style={{ marginBottom:'0.9rem' }}>
            <label style={lbl}>Address (one line per row)</label>
            <textarea style={{ ...inp, minHeight:'64px', resize:'vertical', fontFamily:'Manrope,sans-serif' }}
              value={form.address_lines.join('\n')}
              onChange={e => set('address_lines', e.target.value.split('\n'))}
              placeholder={'20/1/5 Bhagaban Chatterjee Lane,\nKadamtala, Howrah- 711101.'} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.9rem' }}>
            <div><label style={lbl}>Phones (comma-separated)</label>
              <input style={inp} value={form.phones.join(', ')} onChange={e=>set('phones', e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="9088801015, 9088801016" /></div>
            <div><label style={lbl}>Email</label>
              <input style={inp} value={form.email} onChange={e=>set('email', e.target.value)} placeholder="corporatepartner.healthycian@gmail.com" /></div>
            <div><label style={lbl}>Website</label>
              <input style={inp} value={form.website} onChange={e=>set('website', e.target.value)} placeholder="www.healthycianhealthcare.com" /></div>
          </div>
        </div>

        {/* ── Layout ─────────────────────────────────────────── */}
        <div style={S.card}>
          <div style={sectionTitle}>Report Layout</div>
          <p style={hint}>How multiple test panels flow in one combined report.</p>
          <div style={{ display:'flex', gap:'0.8rem', marginTop:'0.9rem' }}>
            {[
              { v:'continuous', title:'Continuous', desc:'All panels flow one after another on shared pages.' },
              { v:'page_break',  title:'Page Break',  desc:'Each test panel starts on its own page.' },
            ].map(opt => (
              <div key={opt.v} onClick={() => set('layout', opt.v)}
                style={{ flex:1, cursor:'pointer', borderRadius:'11px', padding:'0.9rem 1rem',
                  border: form.layout === opt.v ? '1.5px solid #f97316' : '1.5px solid #e8ecf4',
                  background: form.layout === opt.v ? 'rgba(249,115,22,0.06)' : '#fafbfc' }}>
                <div style={{ fontWeight:700, fontSize:'0.85rem', color:'#0f1218', marginBottom:'0.25rem', fontFamily:'Manrope,sans-serif' }}>
                  {form.layout === opt.v ? '● ' : '○ '}{opt.title}
                </div>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', lineHeight:1.4 }}>{opt.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Logo upload ────────────────────────────────────── */}
        <AssetUploadCard
          title="Lab Logo"
          hintText="Shown top-left of every report and as a faint watermark behind the body. PNG, JPG or WEBP, up to 3 MB."
          previewUrl={form.logo_url}
          fallbackNote="Using the built-in Healthycian logo (none uploaded)."
          uploading={uploading === 'logo'}
          inputRef={logoInputRef}
          onPick={(f) => upload('logo', f)}
          onReset={() => resetAsset('logo')}
          canReset={!!form.logo_filename}
        />

      </div>

      <div style={{ marginTop:'1.5rem', display:'flex', justifyContent:'flex-end' }}>
        <button onClick={save} disabled={saving}
          style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.75rem 2rem', fontWeight:700, cursor:'pointer', fontSize:'0.88rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
          {saving ? 'Saving...' : 'Save Report Settings'}
        </button>
      </div>
    </div>
  );
}

function AssetUploadCard({ title, hintText, previewUrl, fallbackNote, uploading, inputRef, onPick, onReset, canReset }) {
  const [drag, setDrag] = useState(false);
  return (
    <div style={S.card}>
      <div style={sectionTitle}>{title}</div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
        style={{
          border: `1.5px dashed ${drag ? '#f97316' : '#e8ecf4'}`, borderRadius:'11px', padding:'1.2rem',
          display:'flex', alignItems:'center', gap:'1rem', cursor:'pointer',
          background: drag ? 'rgba(249,115,22,0.05)' : '#fafbfc', minHeight:'96px',
        }}>
        {previewUrl ? (
          <img src={previewUrl} alt={title} style={{ maxHeight:'70px', maxWidth:'160px', objectFit:'contain', background:'#fff', border:'1px solid #e8ecf4', borderRadius:'8px', padding:'0.4rem' }} />
        ) : (
          <div style={{ width:'70px', height:'70px', borderRadius:'8px', background:'#fff', border:'1px dashed #d8dde6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem', color:'#c2c8d4', flexShrink:0 }}>🖼️</div>
        )}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
            {uploading ? 'Uploading...' : previewUrl ? 'Click or drop to replace' : 'Click or drop an image to upload'}
          </div>
          <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.2rem' }}>{previewUrl ? '' : fallbackNote}</div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      <p style={hint}>{hintText}</p>
      {canReset && (
        <button onClick={onReset} disabled={uploading}
          style={{ marginTop:'0.6rem', background:'transparent', color:'#dc2626', border:'1px solid rgba(220,38,38,0.25)', borderRadius:'8px', padding:'0.4rem 0.9rem', fontSize:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>
          Remove & use default
        </button>
      )}
    </div>
  );
}
