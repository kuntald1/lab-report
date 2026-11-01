import { useState } from 'react';
import { authedFetch } from '../services/auth';

/**
 * Two jobs, one dialog:
 *
 *  - no `target`  → the logged-in user changes their OWN password. Proves the
 *                   current password first (POST /auth/change-password).
 *  - with `target`→ an admin sets someone else's password from Users & Staff.
 *                   No current password to prove (PUT /admin/users/{id}).
 */
export default function ChangePasswordModal({ target = null, onClose, onDone = () => {} }) {
  const self = !target;
  const [cur, setCur]   = useState('');
  const [pw1, setPw1]   = useState('');
  const [pw2, setPw2]   = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const submit = async () => {
    setErr('');
    if (self && !cur) return setErr('Enter your current password');
    if (pw1.length < 6) return setErr('New password must be at least 6 characters');
    if (pw1 !== pw2)    return setErr('The two new passwords do not match');
    setBusy(true);
    try {
      const res = self
        ? await authedFetch('/auth/change-password', { method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ current_password: cur, new_password: pw1 }) })
        : await authedFetch(`/admin/users/${target.id}`, { method:'PUT',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ password: pw1 }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'failed'); }
      onDone(self ? 'Your password has been changed'
                  : `Password reset for ${target.full_name || target.email}`);
      onClose();
    } catch (e) { setErr(String(e.message || 'Could not change the password')); }
    setBusy(false);
  };

  const inp = { width:'100%', padding:'0.6rem 0.75rem', border:'1px solid #e8ecf4', borderRadius:'9px',
                fontSize:'0.85rem', fontFamily:'Manrope,sans-serif', boxSizing:'border-box', background:'#fff' };
  const lbl = { display:'block', fontSize:'0.66rem', fontWeight:700, color:'#8892a4',
                textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:'0.3rem' };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(15,18,24,0.45)', zIndex:200,
               display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:'#fff', borderRadius:'14px', width:'100%', maxWidth:'390px',
                 padding:'1.4rem 1.5rem', boxShadow:'0 20px 60px rgba(15,18,24,0.25)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
          <div>
            <div style={{ fontSize:'1.05rem', fontWeight:800, color:'#0f1218' }}>
              {self ? 'Change Password' : 'Reset Password'}
            </div>
            <div style={{ fontSize:'0.74rem', color:'#8892a4', marginTop:'0.15rem' }}>
              {self ? 'You will stay signed in on this device.'
                    : `${target.full_name || target.email} will need the new password next time they sign in.`}
            </div>
          </div>
          <button onClick={onClose}
            style={{ border:'none', background:'transparent', fontSize:'1.3rem', color:'#c4cad6', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        <div style={{ display:'grid', gap:'0.75rem' }}>
          {self && (
            <div><label style={lbl}>Current password</label>
              <input type={show ? 'text' : 'password'} style={inp} value={cur} autoFocus
                     onChange={e=>setCur(e.target.value)} /></div>
          )}
          <div><label style={lbl}>New password</label>
            <input type={show ? 'text' : 'password'} style={inp} value={pw1} autoFocus={!self}
                   onChange={e=>setPw1(e.target.value)} /></div>
          <div><label style={lbl}>Repeat new password</label>
            <input type={show ? 'text' : 'password'} style={inp} value={pw2}
                   onChange={e=>setPw2(e.target.value)}
                   onKeyDown={e=>{ if (e.key === 'Enter' && !busy) submit(); }} /></div>

          <label style={{ display:'flex', alignItems:'center', gap:'0.4rem', fontSize:'0.75rem', color:'#64748b', cursor:'pointer' }}>
            <input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}
                   style={{ width:'14px', height:'14px', accentColor:'#f97316', cursor:'pointer' }} />
            Show passwords
          </label>

          {err && (
            <div style={{ background:'rgba(220,38,38,0.08)', color:'#dc2626', border:'1px solid rgba(220,38,38,0.2)',
                          borderRadius:'8px', padding:'0.5rem 0.7rem', fontSize:'0.76rem', fontWeight:600 }}>{err}</div>
          )}
        </div>

        <div style={{ display:'flex', gap:'0.6rem', marginTop:'1.2rem' }}>
          <button onClick={submit} disabled={busy}
            style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px',
                     padding:'0.6rem 1.4rem', fontWeight:700, cursor: busy ? 'default' : 'pointer',
                     opacity: busy ? 0.7 : 1, fontFamily:'Manrope,sans-serif' }}>
            {busy ? 'Saving…' : self ? 'Change Password' : 'Reset Password'}
          </button>
          <button onClick={onClose}
            style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px',
                     padding:'0.6rem 1.1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
