import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '../services/auth';

/**
 * Bell badge for rejected samples.
 * Shown in the top bar for lab and franchise logins.
 * onOpen(barcode) — navigates to the results page with that barcode pre-filled.
 */
export default function RejectedBell({ onOpen = () => {} }) {
  const [data, setData] = useState({ count: 0, items: [] });
  const [show, setShow] = useState(false);
  const ref = useRef(null);

  const load = () => authedFetch('/reports/notifications/rejected')
    .then(r => r.ok ? r.json() : { count: 0, items: [] })
    .then(setData).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener('mousedown', onDoc);
    return () => { clearInterval(t); document.removeEventListener('mousedown', onDoc); };
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => { setShow(s => !s); load(); }} title="Rejected samples"
        style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0.3rem' }}>
        🚫
        {data.count > 0 && (
          <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#dc2626', color: '#fff', fontSize: '0.6rem', fontWeight: 800, minWidth: '16px', height: '16px', borderRadius: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{data.count}</span>
        )}
      </button>

      {show && (
        <div style={{ position: 'absolute', top: '120%', right: 0, width: '310px', maxHeight: '360px', overflowY: 'auto', background: '#fff', borderRadius: '12px', boxShadow: '0 16px 48px rgba(15,18,24,0.22)', border: '1px solid #eef1f6', zIndex: 9999 }}>
          <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #f4f6fa', fontWeight: 800, color: '#0f1218', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🚫</span>
            <span>Rejected Samples {data.count > 0 && <span style={{ color: '#dc2626' }}>({data.count})</span>}</span>
          </div>
          {data.items.length === 0
            ? <div style={{ padding: '1.2rem 1rem', color: '#8892a4', fontSize: '0.82rem', textAlign: 'center' }}>No rejected samples 🎉</div>
            : data.items.map(it => (
              <div key={it.patient_id}
                onClick={() => { setShow(false); onOpen(it.barcode); }}
                style={{ padding: '0.7rem 1rem', borderBottom: '1px solid #f7f8fb', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ fontWeight: 700, color: '#0f1218', fontSize: '0.82rem' }}>{it.patient_name}</div>
                <div style={{ color: '#dc2626', fontSize: '0.74rem', fontFamily: 'monospace' }}>
                  {it.barcode} · Sample Rejected
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}
