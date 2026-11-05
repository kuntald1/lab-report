import { useState } from 'react';
import { auth } from '../services/auth';
import healthycianLogo from '../assets/healthycian_logo.png';
import labHero from '../assets/lab-hero.jpg';

/**
 * The sign-in card floats on the left; the right is the lab's own artwork.
 *
 * lab-hero.jpg is only the PHOTOGRAPH — the wordmark, headline, feature strip
 * and footer line are all live markup on top of it. They used to be baked into
 * the picture, and object-fit:cover trimmed the top and bottom of it on a real
 * browser window, which cut the footer off. Markup cannot be cropped, so it
 * now survives any window height, and it stays sharp on a large monitor.
 *
 * Deliberately NOT here, because the lab asked for them out: the Center /
 * Doctor login tabs, "Forgot password?", Google sign-in, and the IP/device
 * tracking notice.
 *
 * The right panel narrows out below 1020px, so a phone gets the card alone.
 */

const FEATURES = [
  { label: ['Streamlined', 'Operations'],  tint: '#e8f6ee', ink: '#2fa36a', icon: 'process'  },
  { label: ['Secure &', 'Reliable'],       tint: '#e7f1fd', ink: '#3b82d6', icon: 'shield'   },
  { label: ['Accurate', 'Reports'],        tint: '#efeafd', ink: '#7c5cd0', icon: 'document' },
  { label: ['Real-time', 'Access'],        tint: '#e3f5f6', ink: '#1f9fae', icon: 'cloud'    },
  { label: ['Better Patient', 'Care'],     tint: '#fdf0dd', ink: '#e0952a', icon: 'heart'    },
];

function Icon({ name }) {
  const c = {
    width: '58%', height: '58%', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  if (name === 'process')  return <svg {...c}><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 3.5v4.2h-4.2" /></svg>;
  if (name === 'shield')   return <svg {...c}><path d="M12 3l7.5 3v5.2c0 4.6-3.2 8.6-7.5 9.8-4.3-1.2-7.5-5.2-7.5-9.8V6z" /><path d="M9 12l2.1 2.2L15.2 10" /></svg>;
  if (name === 'document') return <svg {...c}><path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" /><path d="M14 3v4h4" /><path d="M9 16l1.8 1.8L14.5 14" /></svg>;
  if (name === 'cloud')    return <svg {...c}><path d="M7.2 19a4.2 4.2 0 0 1 .5-8.4 5.3 5.3 0 0 1 10.1 1.3A3.6 3.6 0 0 1 17.4 19z" /></svg>;
  return <svg {...c}><path d="M12 20.3S4.6 15.7 4.6 10.8a4.2 4.2 0 0 1 7.4-2.7 4.2 4.2 0 0 1 7.4 2.7c0 4.9-7.4 9.5-7.4 9.5z" /></svg>;
}

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
                  alignItems: 'center', background: '#f6fbfc', fontFamily: 'Manrope,sans-serif' }}>

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

      {/* ── right: the photo, with every word of it live markup on top.
           Hidden on a narrow screen. ── */}
      <div className="login-side"
           style={{ position: 'relative', flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}>

        {/* the photo only. Its left edge is faded so the join with the tinted
            form side does not read as a hard vertical line. */}
        <img src={labHero} alt="" aria-hidden="true"
             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover', objectPosition: 'center',
                      WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 3.5%)',
                      maskImage: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 3.5%)' }} />

        {/* a column the height of the window: the spacer below takes up the
            slack, so the strip and the footer sit on the bottom edge whatever
            the window height is, and neither can be cropped away */}
        <div style={{ position: 'relative', height: '100%', boxSizing: 'border-box',
                      display: 'flex', flexDirection: 'column',
                      padding: 'clamp(1rem, 4.5vh, 3.2rem) 9% clamp(0.9rem, 3.5vh, 2.4rem) 8%' }}>

          <img src={healthycianLogo} alt="Healthycian"
               style={{ width: 'clamp(170px, 23%, 310px)', display: 'block', flex: '0 0 auto' }} />

          {/* two growing gaps, the lower one twice the upper: the headline
              settles between the wordmark and the strip instead of clinging to
              the top, and both collapse first when the window gets short */}
          <div style={{ flex: '1 1 auto', minHeight: 'clamp(1rem, 4vh, 3.4rem)' }} />

          <div style={{ flex: '0 0 auto',
                        fontSize: 'clamp(1.6rem, 2.85vw, 3rem)', fontWeight: 800, color: '#13294b',
                        lineHeight: 1.17, letterSpacing: '-0.02em' }}>
            Smarter Lab<br />Management for a<br />
            <span style={{ color: '#16a34a' }}>Healthier Tomorrow</span>
          </div>

          <div style={{ flex: '0 0 auto', marginTop: 'clamp(0.5rem, 1.8vh, 1.1rem)',
                        fontSize: 'clamp(0.82rem, 1.05vw, 1.18rem)', color: '#475569' }}>
            Efficient. Accurate. Connected.
          </div>

          <svg viewBox="0 0 300 20" aria-hidden="true"
               style={{ flex: '0 0 auto', display: 'block', marginTop: 'clamp(0.4rem, 1.5vh, 1rem)',
                        width: 'clamp(145px, 15vw, 255px)', height: '14px' }}>
            <path d="M5 15C68 5 212 3 295 9" stroke="#16a34a" strokeWidth="5" strokeLinecap="round" fill="none" />
          </svg>

          <div style={{ flex: '2 1 auto', minHeight: 'clamp(0.8rem, 3vh, 2.6rem)' }} />

          <div style={{ flex: '0 0 auto', background: '#fff', borderRadius: '18px',
                        boxShadow: '0 14px 44px rgba(15,23,42,0.13)',
                        padding: 'clamp(0.9rem, 2.4vh, 1.7rem) clamp(0.5rem, 1.4vw, 1.2rem)',
                        display: 'flex', alignItems: 'flex-start' }}>
            {FEATURES.map((f, i) => (
              <div key={f.label.join(' ')}
                   style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', padding: '0 0.3rem',
                            borderLeft: i ? '1px solid #e8eef4' : 'none' }}>
                <div style={{ width: 'clamp(34px, 2.6vw, 50px)', height: 'clamp(34px, 2.6vw, 50px)',
                              borderRadius: '50%', background: f.tint, color: f.ink,
                              margin: '0 auto clamp(0.35rem, 1vh, 0.7rem)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={f.icon} />
                </div>
                <div style={{ fontSize: 'clamp(0.62rem, 0.78vw, 0.88rem)', fontWeight: 700,
                              color: '#13294b', lineHeight: 1.3 }}>
                  {f.label[0]}<br />{f.label[1]}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: '0 0 auto', marginTop: 'clamp(0.6rem, 2vh, 1.3rem)', textAlign: 'right',
                        fontSize: 'clamp(0.62rem, 0.75vw, 0.85rem)', fontWeight: 600,
                        color: '#9fb3c6', letterSpacing: '0.01em' }}>
            Healthy Labs &nbsp;•&nbsp; Healthier Communities
          </div>
        </div>
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
