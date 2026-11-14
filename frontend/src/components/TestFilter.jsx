import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '../services/auth';

/**
 * One drop-down holding both individual tests and test groups (packages).
 *
 * The value it hands back is a single string — "t:317" for a test, "p:12" for a
 * group — so a page keeps one filter field instead of two. `splitTestFilter`
 * turns that back into the two query parameters the API takes.
 *
 * Groups are listed first and labelled, because a lab that bills "THYROID
 * PROFILE" thinks of it as one thing, while its three member tests also exist
 * individually and would otherwise be indistinguishable in the list.
 */
export function splitTestFilter(v) {
  const s = String(v || '');
  if (s.startsWith('p:')) return { package_id: s.slice(2) };
  if (s.startsWith('t:')) return { test_id: s.slice(2) };
  return {};
}

export default function TestFilter({ value, onChange, style, label = 'Test / Group' }) {
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState('');
  const [hi, setHi]     = useState(0);
  const box = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      authedFetch('/catalog/tests').then(r => r.ok ? r.json() : []).catch(() => []),
      authedFetch('/catalog/packages').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([tests, packs]) => {
      if (!alive) return;
      const g = (Array.isArray(packs) ? packs : [])
        .map(p => ({ value: `p:${p.id}`, label: p.name, group: true }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const t = (Array.isArray(tests) ? tests : [])
        .filter(x => x.is_active !== false)
        .map(x => ({ value: `t:${x.id}`, label: x.name, group: false }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setOpts([...g, ...t]);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const chosen = opts.find(o => o.value === value);
  const needle = q.trim().toLowerCase();
  const shown  = needle ? opts.filter(o => o.label.toLowerCase().includes(needle)) : opts;
  const groups = shown.filter(o => o.group);
  const tests  = shown.filter(o => !o.group);
  const flat   = [...groups, ...tests];
  const pick   = (v) => { onChange(v); setOpen(false); setQ(''); setHi(0); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && flat[hi]) pick(flat[hi].value); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };

  const lbl = { fontSize:'0.64rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
  const head = { position:'sticky', top:0, background:'#f8fafc', padding:'0.4rem 0.9rem', fontSize:'0.62rem', fontWeight:800, letterSpacing:'0.08em', color:'#64748b', textTransform:'uppercase', borderBottom:'1px solid #eef1f6' };
  const row = (o, i) => {
    const on = flat[hi] === o;
    return (
      <div key={o.value} onMouseDown={() => pick(o.value)} onMouseEnter={() => setHi(i)}
        style={{ display:'flex', alignItems:'center', gap:'0.55rem', padding:'0.55rem 0.9rem', cursor:'pointer', fontSize:'0.85rem', color:'#0f1218',
                 background: on ? '#fff4e8' : (o.value === value ? '#fffaf3' : 'transparent') }}>
        <span style={{ flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{o.label}</span>
        {o.group && <span style={{ fontSize:'0.58rem', fontWeight:800, color:'#c2410c', background:'rgba(249,115,22,0.12)', borderRadius:'20px', padding:'0.1rem 0.5rem', letterSpacing:'0.05em' }}>GROUP</span>}
        {o.value === value && <span style={{ color:'#f97316', fontWeight:800 }}>✓</span>}
      </div>
    );
  };

  return (
    <div ref={box} style={{ gridColumn:'span 2', minWidth:0 }}>
      <label style={lbl}>{label}</label>
      <div style={{ position:'relative' }}>
        <div onClick={() => { setOpen(true); inputRef.current && inputRef.current.focus(); }}
          style={{ ...style, display:'flex', alignItems:'center', gap:'0.5rem', cursor:'text', padding:'0 0.7rem', height:style?.height || '2.5rem',
                   borderColor: open ? '#f97316' : style?.borderColor }}>
          <span style={{ color:'#94a3b8', fontSize:'0.9rem' }}>🔍</span>
          {chosen && !open ? (
            <span style={{ flex:1, display:'flex', alignItems:'center', gap:'0.5rem', minWidth:0 }}>
              <span style={{ fontWeight:600, color:'#0f1218', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{chosen.label}</span>
              {chosen.group && <span style={{ fontSize:'0.58rem', fontWeight:800, color:'#c2410c', background:'rgba(249,115,22,0.12)', borderRadius:'20px', padding:'0.1rem 0.5rem' }}>GROUP</span>}
            </span>
          ) : null}
          <input ref={inputRef} value={q}
            onChange={e => { setQ(e.target.value); setOpen(true); setHi(0); }}
            onFocus={() => setOpen(true)} onKeyDown={onKey}
            placeholder={chosen ? '' : 'All tests — type to search'}
            style={{ flex: chosen && !open ? '0 0 2px' : 1, width: chosen && !open ? 2 : undefined, minWidth:0, border:'none', outline:'none', background:'transparent', font:'inherit', color:'#0f1218', padding:0 }} />
          {chosen && (
            <span title="Clear" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); pick(''); }}
              style={{ cursor:'pointer', color:'#94a3b8', fontWeight:800, padding:'0 0.2rem' }}>✕</span>
          )}
        </div>

        {open && (
          <div style={{ position:'absolute', zIndex:60, left:0, top:'calc(100% + 4px)', width:'max(100%, 380px)', maxHeight:'320px', overflowY:'auto',
                        background:'#fff', border:'1px solid #e8ecf4', borderRadius:'12px', boxShadow:'0 12px 32px rgba(15,18,24,0.16)' }}>
            {!needle && (
              <div onMouseDown={() => pick('')} style={{ padding:'0.55rem 0.9rem', cursor:'pointer', color:'#64748b', fontSize:'0.85rem', borderBottom:'1px solid #eef1f6' }}>All tests</div>
            )}
            {groups.length > 0 && <div style={head}>Test groups · {groups.length}</div>}
            {groups.map((o, i) => row(o, i))}
            {tests.length > 0 && <div style={head}>Individual tests · {tests.length}</div>}
            {tests.map((o, i) => row(o, groups.length + i))}
            {flat.length === 0 && <div style={{ padding:'0.8rem 0.9rem', color:'#8892a4', fontSize:'0.84rem' }}>No test or group matches “{q}”</div>}
          </div>
        )}
      </div>
    </div>
  );
}
