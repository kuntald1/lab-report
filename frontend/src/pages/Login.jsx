import { useState } from 'react';
import { auth } from '../services/auth';

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
    width: '100%', padding: '0.7rem 0.9rem', borderRadius: '10px',
    border: '1px solid #e8ecf4', fontSize: '0.9rem', outline: 'none',
    background: '#f8fafc', marginTop: '0.35rem', boxSizing: 'border-box',
  };
  const label = { fontSize: '0.72rem', fontWeight: 700, color: '#8892a4', letterSpacing: '0.03em' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg,#1a1f2e 0%,#0f1218 100%)' }}>
      <div style={{ width: '370px', background: '#fff', borderRadius: '18px', padding: '2.2rem 2rem',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '1.6rem' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
                        background: 'linear-gradient(135deg,#f97316,#fbbf24)',
                        boxShadow: '0 6px 18px rgba(249,115,22,0.4)' }}>🔬</div>
          <div>
            <div style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.2rem', fontWeight: 800, color: '#0f1218' }}>MediCloud</div>
            <div style={{ fontSize: '0.66rem', color: '#8892a4', letterSpacing: '0.04em' }}>Laboratory Information System</div>
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
          style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none',
                   cursor: busy ? 'default' : 'pointer', fontSize: '0.9rem', fontWeight: 700, color: '#fff',
                   background: busy ? '#fcaa6b' : 'linear-gradient(135deg,#f97316,#fbbf24)',
                   boxShadow: '0 6px 18px rgba(249,115,22,0.35)' }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
