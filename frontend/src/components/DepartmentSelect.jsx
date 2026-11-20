import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

/** Department drop-down for filter bars. Value is the department id (string) or ''. */
export default function DepartmentSelect({ value, onChange, style, label = 'Department', labelStyle }) {
  const [depts, setDepts] = useState([]);
  useEffect(() => {
    let alive = true;
    authedFetch('/catalog/departments').then(r => r.ok ? r.json() : []).catch(() => [])
      .then(d => { if (alive) setDepts(Array.isArray(d) ? d : []); });
    return () => { alive = false; };
  }, []);
  const lbl = labelStyle || { fontSize:'0.66rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
  return (
    <div>
      <label style={lbl}>{label}</label>
      <select style={style} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </div>
  );
}
