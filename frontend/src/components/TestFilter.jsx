import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';
import SearchSelect from './SearchSelect';

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

  useEffect(() => {
    let alive = true;
    Promise.all([
      authedFetch('/catalog/tests').then(r => r.ok ? r.json() : []).catch(() => []),
      authedFetch('/catalog/packages').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([tests, packs]) => {
      if (!alive) return;
      const g = (Array.isArray(packs) ? packs : [])
        .map(p => ({ value: `p:${p.id}`, label: `[Group] ${p.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const t = (Array.isArray(tests) ? tests : [])
        .filter(x => x.is_active !== false)
        .map(x => ({ value: `t:${x.id}`, label: x.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setOpts([...g, ...t]);
    });
    return () => { alive = false; };
  }, []);

  const lbl = { fontSize:'0.64rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
  return (
    <div>
      <label style={lbl}>{label}</label>
      <SearchSelect style={style} value={value} onChange={onChange}
        emptyLabel="All" placeholder="Type a test or group…" options={opts} />
    </div>
  );
}
