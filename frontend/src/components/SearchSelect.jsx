import { useEffect, useRef, useState } from 'react';

/**
 * A drop-down you can type into. Pass options as [{ value, label }]; `emptyLabel`
 * is the first, always-visible choice that maps to value ''. onChange receives the
 * chosen value as a string, the same as a native <select>, so it drops in place of one.
 */
export default function SearchSelect({ value, onChange, options, emptyLabel = '— None —', disabled, style, placeholder = 'Type to search…' }) {
  const [open, setOpen]   = useState(false);
  const [q, setQ]         = useState('');
  const box               = useRef(null);
  const chosen            = options.find(o => String(o.value) === String(value));

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const needle = q.trim().toLowerCase();
  const shown  = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;
  const pick   = (v) => { onChange(String(v)); setOpen(false); setQ(''); };

  return (
    <div ref={box} style={{ position:'relative' }}>
      <input
        style={{ ...style, cursor: disabled ? 'not-allowed' : 'text' }}
        disabled={disabled}
        value={open ? q : (chosen ? chosen.label : emptyLabel)}
        placeholder={open ? placeholder : undefined}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQ(''); e.currentTarget.blur(); }
                          if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) pick(shown[0].value); } }}
      />
      {open && !disabled && (
        <div style={{ position:'absolute', zIndex:50, left:0, right:0, top:'calc(100% + 4px)', maxHeight:'280px', overflowY:'auto',
                      background:'#fff', border:'1px solid #e8ecf4', borderRadius:'10px', boxShadow:'0 8px 24px rgba(15,18,24,0.12)' }}>
          {!needle && (
            <div onMouseDown={() => pick('')} style={{ padding:'0.6rem 0.9rem', cursor:'pointer', color:'#8892a4', fontSize:'0.86rem' }}>{emptyLabel}</div>
          )}
          {shown.map(o => (
            <div key={o.value} onMouseDown={() => pick(o.value)}
                 style={{ padding:'0.6rem 0.9rem', cursor:'pointer', fontSize:'0.86rem', color:'#0f1218',
                          background: String(o.value) === String(value) ? '#fff4e8' : 'transparent' }}
                 onMouseEnter={e => e.currentTarget.style.background = '#f4f6fa'}
                 onMouseLeave={e => e.currentTarget.style.background = String(o.value) === String(value) ? '#fff4e8' : 'transparent'}>
              {o.label}
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding:'0.7rem 0.9rem', color:'#8892a4', fontSize:'0.84rem' }}>No match</div>}
        </div>
      )}
    </div>
  );
}
