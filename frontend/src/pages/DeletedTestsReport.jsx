import { useEffect, useState } from 'react';
import { authedFetch, auth } from '../services/auth';
import SearchSelect from '../components/SearchSelect';

// Tests (or whole test groups) an admin took off a bill — who, when, why and how
// much came off. Same filter bar as Sample / Test Details; the dates are the
// day the test was deleted and Status is the stage the test had reached then.

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.55rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.64rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
const S = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.3rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const money = (n) => '₹' + (Number(n||0)).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';
const STATUSES = ['', 'collected', 'received', 'tested', 'validated', 'reported', 'sample_rejected'];
const statusColor = (s) => ({ collected:'#64748b', received:'#0891b2', tested:'#b45309', validated:'#0f766e', reported:'#16a34a', sample_rejected:'#dc2626' }[s] || '#8892a4');
const EMPTY = { franchise_id:'', branch_id:'', date_from:'', date_to:'', patient_id:'', patient_name:'', barcode:'', status:'' };

export default function DeletedTestsReport() {
  const me = auth.user ? auth.user() : null;
  const isFranchise = (me?.role || '').toLowerCase() === 'franchise';
  const myFranchiseId = isFranchise ? String(me?.franchise_id || '') : '';
  const [f, setF] = useState({ ...EMPTY, franchise_id: myFranchiseId });
  const [data, setData] = useState({ rows:[], totals:{} });
  const [loading, setLoading] = useState(false);
  const [franchises, setFranchises] = useState([]);

  useEffect(() => {
    authedFetch('/admin/franchises').then(r=>r.ok?r.json():[]).then(d=>setFranchises(Array.isArray(d)?d:(d.items||[]))).catch(()=>{});
    load(f);
  }, []); // eslint-disable-line

  const load = (filters = f) => {
    setLoading(true);
    const qs = Object.entries(filters).filter(([,v])=>v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    authedFetch(`/reports2/deleted-tests${qs?`?${qs}`:''}`).then(r=>r.ok?r.json():{rows:[],totals:{}})
      .then(d=>{ setData(d); setLoading(false); }).catch(()=>setLoading(false));
  };
  const set = (k,v) => setF(prev=>({ ...prev, [k]:v }));
  const clear = () => { const c = { ...EMPTY, franchise_id: myFranchiseId }; setF(c); load(c); };

  const exportCsv = () => {
    const q = (x) => `"${String(x ?? '').replace(/"/g,'""')}"`;
    const head = ['Deleted On','Deleted By','Reason','Bill No','Patient ID','Barcode','Patient','Test / Group','Tests in Group','Accession No','Stage','Franchise','Branch','Amount'];
    const lines = [head.join(',')];
    data.rows.forEach(r => lines.push([q(fmt(r.deleted_at)), q(r.deleted_by), q(r.reason), r.bill_no, r.patient_id, r.barcode, q(r.patient_name),
      q(r.name), q((r.members||[]).join(' | ')), r.accession_number||'', r.status||'', q(r.franchise), q(r.branch), r.amount].join(',')));
    const blob = new Blob([lines.join('\n')], { type:'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'deleted-tests.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const th = { padding:'0.7rem 1rem', textAlign:'left', fontSize:'0.66rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' };
  const td = { padding:'0.7rem 1rem', fontSize:'0.8rem', color:'#0f1218', verticalAlign:'top' };

  return (
    <div>
      <div style={{ marginBottom:'1.3rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(220,38,38,0.07)', border:'1px solid rgba(220,38,38,0.2)', color:'#dc2626', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.5rem' }}>Reports</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Deleted Tests</h1>
        <div style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>Tests and test groups removed from bills — who removed them, when and why.</div>
      </div>

      {/* filters */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'0.8rem', alignItems:'end' }}>
          <div><label style={lbl}>Franchise</label>
            <SearchSelect style={{...inp, background: isFranchise?'#f1f3f7':''}} disabled={isFranchise} value={f.franchise_id}
              onChange={v=>set('franchise_id',v)} emptyLabel="All" placeholder="Type code or name…"
              options={franchises
                .map(fr => ({ value: fr.id, label: (fr.code && !String(fr.name||'').toUpperCase().startsWith(String(fr.code).trim().toUpperCase())) ? `${fr.code} - ${fr.name}` : fr.name }))
                .sort((a,b)=>a.label.localeCompare(b.label))} />
          </div>
          <div><label style={lbl}>Branch ID</label><input style={inp} value={f.branch_id} onChange={e=>set('branch_id',e.target.value)} placeholder="e.g. 1" /></div>
          <div><label style={lbl}>Deleted from</label><input style={inp} type="date" value={f.date_from} onChange={e=>set('date_from',e.target.value)} /></div>
          <div><label style={lbl}>Deleted to</label><input style={inp} type="date" value={f.date_to} onChange={e=>set('date_to',e.target.value)} /></div>
          <div><label style={lbl}>Patient ID</label><input style={inp} value={f.patient_id} onChange={e=>set('patient_id',e.target.value)} /></div>
          <div><label style={lbl}>Patient Name</label><input style={inp} value={f.patient_name} onChange={e=>set('patient_name',e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') load(); }} placeholder="e.g. Sujit" /></div>
          <div><label style={lbl}>Barcode</label><input style={inp} value={f.barcode} onChange={e=>set('barcode',e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') load(); }} placeholder="barcode / accession" /></div>
          <div><label style={lbl}>Stage when deleted</label>
            <select style={inp} value={f.status} onChange={e=>set('status',e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{s ? (s[0].toUpperCase()+s.slice(1)).replace('_',' ') : 'All'}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button onClick={()=>load()} style={{ flex:1, background:'linear-gradient(135deg,#6366f1,#818cf8)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply</button>
            <button onClick={clear} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.9rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
          </div>
        </div>
      </div>

      {/* totals */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'0.8rem', marginBottom:'1.2rem' }}>
        {[['Deletions', data.totals.deletions||0, '#dc2626'], ['Bills affected', data.totals.bills||0, '#6366f1'], ['Amount removed', money(data.totals.amount), '#0f1218']].map(([k,v,c]) => (
          <div key={k} style={{ ...S.card, padding:'1rem 1.2rem' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:c, fontFamily:'Manrope,sans-serif' }}>{v}</div>
            <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600, marginTop:'0.2rem' }}>{k}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'0.6rem' }}>
        <button onClick={exportCsv} disabled={!data.rows.length} style={{ background:'#fff', color:'#16a34a', border:'1.5px solid #16a34a', borderRadius:'9px', padding:'0.5rem 1.1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', opacity: data.rows.length ? 1 : 0.5 }}>⬇ Export CSV</button>
      </div>

      <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'900px' }}>
          <thead><tr style={{ background:'#f8f9fc', borderBottom:'1px solid #eef1f6' }}>
            <th style={th}>Deleted on</th><th style={th}>Bill</th><th style={th}>Patient</th><th style={th}>Test / Group</th>
            <th style={th}>Stage</th><th style={th}>Franchise / Branch</th><th style={th}>Deleted by</th><th style={{ ...th, textAlign:'right' }}>Amount</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ ...td, color:'#8892a4', textAlign:'center', padding:'2rem' }}>Loading…</td></tr>}
            {!loading && data.rows.length === 0 && <tr><td colSpan={8} style={{ ...td, color:'#8892a4', textAlign:'center', padding:'2rem' }}>No deleted tests for these filters.</td></tr>}
            {!loading && data.rows.map(r => (
              <tr key={r.id} style={{ borderBottom:'1px solid #f1f3f7' }}>
                <td style={{ ...td, whiteSpace:'nowrap', color:'#475569' }}>{fmt(r.deleted_at)}</td>
                <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>{r.bill_no}</td>
                <td style={td}>
                  <div style={{ fontWeight:600 }}>{r.patient_name || '—'}</div>
                  <div style={{ color:'#6366f1', fontFamily:'monospace', fontSize:'0.74rem' }}>{r.barcode || '—'}{r.patient_id ? <span style={{ color:'#8892a4' }}> · #{r.patient_id}</span> : null}</div>
                </td>
                <td style={td}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', flexWrap:'wrap' }}>
                    <span style={{ textDecoration:'line-through', color:'#475569', fontWeight:600 }}>{r.name}</span>
                    {r.is_group && <span style={{ fontSize:'0.58rem', background:'rgba(249,115,22,0.12)', color:'#c2410c', padding:'0.1rem 0.45rem', borderRadius:'20px', fontWeight:700 }}>GROUP</span>}
                  </div>
                  {r.is_group && <div style={{ color:'#94a3b8', fontSize:'0.72rem', marginTop:'0.15rem' }}>{r.members.join(', ')}</div>}
                  {r.accession_number && <div style={{ color:'#94a3b8', fontSize:'0.7rem', fontFamily:'monospace', marginTop:'0.1rem' }}>{r.accession_number}</div>}
                </td>
                <td style={td}>{r.status ? <span style={{ fontSize:'0.68rem', fontWeight:700, color: statusColor(r.status), background: statusColor(r.status)+'18', padding:'0.15rem 0.55rem', borderRadius:'20px', whiteSpace:'nowrap' }}>{r.status.replace('_',' ')}</span> : '—'}</td>
                <td style={td}><div>{r.franchise}</div><div style={{ color:'#8892a4', fontSize:'0.72rem' }}>{r.branch}</div></td>
                <td style={td}>
                  <div style={{ fontWeight:600 }}>{r.deleted_by || '—'}</div>
                  {r.reason && <div style={{ color:'#8892a4', fontSize:'0.72rem', fontStyle:'italic' }}>“{r.reason}”</div>}
                </td>
                <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#dc2626', whiteSpace:'nowrap' }}>– {money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
