import { useState } from 'react';
import { auth } from '../services/auth';
import healthycianLogo from '../assets/healthycian_logo.png';
import labArt from '../assets/lab-illustration.svg';

/**
 * Two panels: the sign-in card on the left, the lab's own story on the right.
 *
 * Deliberately NOT here, because the lab asked for them out: the Center /
 * Doctor login tabs (one login serves every role, and the role decides the
 * menu), "Forgot password?" (an admin resets it from Users & Staff), Google
 * sign-in, and the IP/device tracking notice.
 *
 * The right panel narrows out below 980px, so a phone gets the card alone.
 */

// The lab's real flow, the one Change Report Status and the TAT report follow.
const FLOW = [
  { n: '1', icon: '📝', label: 'Registration' },
  { n: '2', icon: '🩸', label: 'Collected' },
  { n: '3', icon: '📦', label: 'Received' },
  { n: '4', icon: '🔬', label: 'Tested' },
  { n: '5', icon: '✅', label: 'Validated' },
  { n: '6', icon: '📄', label: 'Reported' },
  { n: '7', icon: '📊', label: 'Analytics' },
];

export default function Login({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow]         = useState(false);
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);

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

  const field = {
    width: '100%', padding: '0.85rem 1rem 0.85rem 2.6rem', borderRadius: '10px',
    border: '1px solid #e2e8f0', fontSize: '0.92rem', outline: 'none',
    background: '#f8fafc', boxSizing: 'border-box', color: '#0f172a',
    fontFamily: 'Manrope,sans-serif',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#ffffff', fontFamily: 'Manrope,sans-serif' }}>

      {/* ── left: sign in ── */}
      <div style={{ flex: '0 0 440px', maxWidth: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: '2rem 1.6rem', background: '#ffffff' }}>
        <div style={{ width: '100%', maxWidth: '360px' }}>

          <img src={healthycianLogo} alt="Healthycian"
               style={{ width: '100%', maxWidth: '300px', display: 'block', marginBottom: '0.5rem' }} />
          <div style={{ fontSize: '0.78rem', color: '#64748b', letterSpacing: '0.02em', marginBottom: '2.2rem' }}>
            Laboratory Information System
          </div>

          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0f172a', textAlign: 'center' }}>Welcome !</div>
          <div style={{ fontSize: '0.86rem', color: '#64748b', textAlign: 'center', marginBottom: '1.8rem' }}>
            Login to your account to continue
          </div>

          <div style={{ position: 'relative', marginBottom: '0.85rem' }}>
            <span style={iconStyle}>✉</span>
            <input style={field} type="email" value={email} autoFocus
                   onChange={e => setEmail(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && submit()}
                   placeholder="Email" />
          </div>

          <div style={{ position: 'relative', marginBottom: '1.4rem' }}>
            <span style={iconStyle}>🔒</span>
            <input style={{ ...field, paddingRight: '2.8rem' }} type={show ? 'text' : 'password'} value={password}
                   onChange={e => setPassword(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && submit()}
                   placeholder="Password" />
            <button type="button" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)',
                       background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.95rem',
                       color: '#94a3b8', padding: '0.3rem' }}>
              {show ? '🙈' : '👁'}
            </button>
          </div>

          {err && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
                          fontSize: '0.78rem', padding: '0.6rem 0.8rem', borderRadius: '9px', marginBottom: '1rem' }}>
              {err}
            </div>
          )}

          <button onClick={submit} disabled={busy}
            style={{ width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
                     cursor: busy ? 'default' : 'pointer', fontSize: '0.98rem', fontWeight: 700, color: '#fff',
                     fontFamily: 'Manrope,sans-serif',
                     background: busy ? '#fcaa6b' : 'linear-gradient(135deg,#f97316,#fbbf24)',
                     boxShadow: '0 6px 18px rgba(249,115,22,0.3)' }}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
      </div>

      {/* ── right: what the lab does. Hidden on a narrow screen. ── */}
      <div className="login-side"
           style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden',
                    background: 'linear-gradient(135deg,#eef6f4 0%,#e4f1fb 55%,#f3f8fd 100%)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    padding: '2.2rem 3.2rem' }}>

        <div style={{ position: 'relative', maxWidth: '620px' }}>
          <div style={{ fontSize: 'clamp(1.9rem, 3.2vw, 2.9rem)', fontWeight: 800, color: '#0f172a',
                        lineHeight: 1.18, letterSpacing: '-0.02em' }}>
            Smarter Lab<br />Management for a<br />
            <span style={{ color: '#17b69e' }}>Healthier Tomorrow</span>
          </div>
          <div style={{ width: '220px', height: '4px', borderRadius: '4px', marginTop: '1rem',
                        background: 'linear-gradient(90deg,#17b69e,rgba(23,182,158,0))' }} />
          <div style={{ marginTop: '1.1rem', fontSize: '0.95rem', color: '#475569', maxWidth: '520px', lineHeight: 1.6 }}>
            Analysers, samples, reports and billing in one place — from the moment a sample
            is registered to the moment the report reaches the patient.
          </div>
        </div>

        <img src={labArt} alt="" aria-hidden="true"
             style={{ position: 'relative', display: 'block', width: '100%', maxWidth: '620px',
                      marginTop: '1.6rem' }} />

        <div style={{ position: 'relative', marginTop: '1.4rem', background: 'rgba(255,255,255,0.78)',
                      border: '1px solid rgba(255,255,255,0.9)', borderRadius: '16px',
                      padding: '1.3rem 1.1rem', backdropFilter: 'blur(4px)',
                      boxShadow: '0 10px 40px rgba(15,23,42,0.07)',
                      display: 'flex', alignItems: 'flex-start', gap: '0.2rem', flexWrap: 'wrap' }}>
          {FLOW.map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'flex-start', flex: '1 1 92px', minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.3rem' }}>
                  {s.n}. {s.label}
                </div>
                <div style={{ fontSize: '1.5rem', lineHeight: 1 }}>{s.icon}</div>
              </div>
              {i < FLOW.length - 1 && (
                <div style={{ color: '#cbd5e1', fontSize: '0.9rem', alignSelf: 'center', padding: '0 0.1rem' }}>›</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .login-side { display: none !important; }
        }
      `}</style>
    </div>
  );
}

const iconStyle = {
  position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)',
  fontSize: '0.9rem', color: '#94a3b8', pointerEvents: 'none',
};
