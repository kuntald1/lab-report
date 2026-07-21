import { useState } from 'react';
import { auth } from '../services/auth';
import healthycianIcon from '../assets/healthycian_icon.png';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      await auth.login(email.trim(), password);
      onLogin();
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  const input = {
    width: '100%', padding: '0.85rem 1rem', borderRadius: '10px',
    border: '1px solid #e8ecf4', fontSize: '0.95rem', outline: 'none',
    background: '#f8fafc', marginTop: '0.4rem', boxSizing: 'border-box',
  };
  const label = { fontSize: '0.76rem', fontWeight: 700, color: '#8892a4', letterSpacing: '0.03em' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgb(26, 31, 46) 0%, rgb(23, 182, 158) 100%)' }}>
      <div style={{ width: '460px', maxWidth: '92vw', background: '#fff', borderRadius: '20px', padding: '2.8rem 2.6rem',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '2rem' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', padding:'6px',
                        background: '#fff', border:'1px solid #eef1f6' }}>
            <img src={healthycianIcon} alt="Healthycian" style={{ width:'100%', height:'100%', objectFit:'contain' }} /></div>
          <div>
            <div style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218' }}>Healthycian</div>
            <div style={{ fontSize: '0.78rem', color: '#8892a4', letterSpacing: '0.04em' }}>Laboratory Information System</div>
          </div>
        </div>

        <div style={{ marginBottom: '0.9rem' }}>
          <div style={label}>EMAIL</div>
          <input style={input} type="email" value={email} autoFocus
                 onChange={e => setEmail(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && submit()}
                 placeholder="admin@medicloud.local" />
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <div style={label}>PASSWORD</div>
          <input style={input} type="password" value={password}
                 onChange={e => setPassword(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && submit()}
                 placeholder="••••••••" />
        </div>

        {err && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
                        fontSize: '0.78rem', padding: '0.6rem 0.8rem', borderRadius: '9px', marginBottom: '1rem' }}>
            {err}
          </div>
        )}

        <button onClick={submit} disabled={busy}
          style={{ width: '100%', padding: '0.9rem', borderRadius: '11px', border: 'none',
                   cursor: busy ? 'default' : 'pointer', fontSize: '0.98rem', fontWeight: 700, color: '#fff',
                   background: busy ? '#fcaa6b' : 'linear-gradient(135deg,#f97316,#fbbf24)',
                   boxShadow: '0 6px 18px rgba(249,115,22,0.35)' }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
