import { useState } from 'react';
import { auth } from '../services/auth';
import healthycianLogo from '../assets/healthycian_logo.png';
import labHero from '../assets/lab-hero.jpg';

/**
 * OPTION A — the supplied banner used whole as the right-hand panel,
 * with the sign-in card floating on the left.
 *
 * Deliberately NOT here, because the lab asked for them out: the Center /
 * Doctor login tabs, "Forgot password?", Google sign-in, and the IP/device
 * tracking notice.
 *
 * The right panel narrows out below 1020px, so a phone gets the card alone.
 */

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
    width: '100%', padding: '0.85rem 1rem 0.85rem 2.7rem', borderRadius: '11px',
    border: '1px solid #e4ebf2', fontSize: '0.92rem', outline: 'none',
    background: '#f7fafc', boxSizing: 'border-box', color: '#0f172a',
    fontFamily: 'Manrope,sans-serif',
  };

  return (
    // height, not minHeight, and the children shrink to fit: the page is meant
    // to sit on one screen at 100% zoom with no scrollbar at all.
    <div style={{ height: '100vh', overflow: 'hidden', position: 'relative', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', background: '#f6fbfc', fontFamily: 'Manrope,sans-serif' }}>

      {/* ── the soft waves in the two corners ── */}
      <svg viewBox="0 0 420 420" aria-hidden="true" preserveAspectRatio="none"
           style={{ position: 'absolute', top: '-9vh', left: '-7vw', width: '34vw', height: '58vh', pointerEvents: 'none' }}>
        <defs>
          <linearGradient id="waveTL" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3ecfb4" stopOpacity="0.30" />
            <stop offset="1" stopColor="#7fd9e8" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d="M0 0h420C380 130 270 160 185 225S45 345 0 420Z" fill="url(#waveTL)" />
      </svg>
      <svg viewBox="0 0 420 420" aria-hidden="true" preserveAspectRatio="none"
           style={{ position: 'absolute', bottom: '-10vh', right: '-6vw', width: '36vw', height: '46vh', pointerEvents: 'none' }}>
        <defs>
          <linearGradient id="waveBR" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#56cf9e" stopOpacity="0.30" />
            <stop offset="1" stopColor="#7fd9e8" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d="M420 420H0C60 300 170 275 250 215S390 90 420 0Z" fill="url(#waveBR)" />
      </svg>

      {/* ── left: the sign-in card ── */}
      <div className="login-form"
           style={{ position: 'relative', flex: '0 0 480px', maxWidth: '100%', minHeight: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 'clamp(1rem, 3vh, 2rem) clamp(1.2rem, 2.5vw, 2.6rem)' }}>
        <div style={{ width: '100%', maxWidth: '400px', background: '#ffffff', borderRadius: '20px',
                      padding: 'clamp(1.4rem, 3.4vh, 2.4rem) clamp(1.3rem, 2.2vw, 2rem)',
                      boxShadow: '0 18px 60px rgba(15,23,42,0.10)', border: '1px solid #eef3f7',
                      maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }}>

          <img className="login-logo" src={healthycianLogo} alt="Healthycian"
               style={{ width: '100%', maxWidth: '276px', display: 'block', marginBottom: 'clamp(1.2rem, 3.4vh, 2.3rem)' }} />

          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f2744' }}>Welcome Back!</div>
          <div style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: 'clamp(1rem, 2.6vh, 1.6rem)' }}>
            Login to your account to continue
          </div>

          <div style={{ position: 'relative', marginBottom: '0.8rem' }}>
            <span style={iconStyle}>✉</span>
            <input style={field} type="email" value={email} autoFocus
                   onChange={e => { setEmail(e.target.value); setErr(''); }}
                   onKeyDown={e => e.key === 'Enter' && submit()}
                   placeholder="Email" />
          </div>

          <div style={{ position: 'relative', marginBottom: '1.2rem' }}>
            <span style={iconStyle}>🔒</span>
            <input style={{ ...field, paddingRight: '2.9rem' }} type={show ? 'text' : 'password'} value={password}
                   onChange={e => { setPassword(e.target.value); setErr(''); }}
                   onKeyDown={e => e.key === 'Enter' && submit()}
                   placeholder="Password" />
            <button type="button" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)',
                       background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.95rem',
                       color: '#94a3b8', padding: '0.3rem' }}>
              {show ? '🙈' : '👁'}
            </button>
          </div>

          {err && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
                          fontSize: '0.78rem', padding: '0.6rem 0.8rem', borderRadius: '9px', marginBottom: '0.9rem' }}>
              {err}
            </div>
          )}

          <button onClick={submit} disabled={busy}
            style={{ width: '100%', padding: '0.92rem', borderRadius: '11px', border: 'none',
                     cursor: busy ? 'default' : 'pointer', fontSize: '0.98rem', fontWeight: 700, color: '#fff',
                     fontFamily: 'Manrope,sans-serif', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', gap: '0.5rem',
                     background: busy ? '#8fd3b4' : 'linear-gradient(90deg,#34b97f,#17b9a1 55%,#19a7c4)',
                     boxShadow: '0 8px 22px rgba(23,185,161,0.28)' }}>
            {busy ? 'Signing in…' : <>Sign In <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>→</span></>}
          </button>
        </div>
      </div>

      {/* ── right: the banner, exactly as supplied. Hidden on a narrow screen. ── */}
      <div className="login-side"
           style={{ position: 'relative', flex: '0 1 auto', minWidth: 0, height: '100vh', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 'clamp(1rem, 3vh, 2.4rem) clamp(1.2rem, 3vw, 3rem) clamp(1rem, 3vh, 2.4rem) 0' }}>
        <img src={labHero} alt="Smarter lab management for a healthier tomorrow"
             style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
                      objectFit: 'contain', borderRadius: '18px',
                      boxShadow: '0 16px 48px rgba(15,23,42,0.12)' }} />
      </div>

      <style>{`
        @media (max-width: 1020px) {
          /* The story panel goes; the card takes the whole screen. Without
             releasing the 480px basis the card sits in a column wider than the
             phone and its right edge is cut off. */
          .login-side { display: none !important; }
          .login-form { flex: 1 1 auto !important; width: 100% !important; }
          .login-logo { margin-left: auto; margin-right: auto; }
        }
        @media (max-width: 420px) {
          .login-logo { max-width: 230px !important; }
        }
      `}</style>
    </div>
  );
}

const iconStyle = {
  position: 'absolute', left: '0.95rem', top: '50%', transform: 'translateY(-50%)',
  fontSize: '0.9rem', color: '#94a3b8', pointerEvents: 'none',
};
