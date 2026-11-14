import { useEffect, useState } from 'react';
import { authedFetch, auth } from '../services/auth';
import SearchSelect from '../components/SearchSelect';
import TestFilter, { splitTestFilter } from '../components/TestFilter';
import ResultEditor from '../components/ResultEditor';

/**
 * Blank Report — a report for a test no analyser ever sends.
 *
 * Search the billed tests exactly as the Bills page does, pick the ones that
 * need a report, and the server creates each one with every parameter the test
 * declares and no values. The rows then open here to be typed in and saved, so
 * a hand-read test reaches the same report as a machine-read one. A test that
 * is going to an outside lab can be marked Outsourced from the same list
 * instead, which is what the Change Status screen does.
 */
const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.55rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.82rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.66rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' };
const S   = { card:{ background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.3rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const STAGES = ['', 'collected','received','tested','validated','reported','outsource','sample_rejected'];
const CAN_CREATE = ['super_admin', 'lab_admin', 'pathologist', 'technician'];
const errText = (d) => Array.isArray(d) ? d.map(x => x?.msg || String(x)).join('; ') : (d || '');
const EMPTY = { organization_id:'', branch_id:'', barcode:'', patient_name:'', patient_id:'', date_from:'', date_to:'', stage:'received', test:'' };

export default function BlankReport() {
  const me = auth.user ? auth.user() : null;
  const allowed = CAN_CREATE.includes((me?.role || '').toLowerCase());

  const [f, setF]           = useState(EMPTY);
  const [bills, setBills]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs]     = useState([]);
  const [branches, setBranches] = useState([]);
  const [picked, setPicked] = useState(() => new Set());   // bill_item ids
  const [made, setMade]     = useState([]);                // reports created, open for editing
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [applied, setApplied] = useState({ stage:'received', test:'' });   // what the list on screen was loaded with

  useEffect(() => {
    authedFetch('/admin/franchises').then(r=>r.ok?r.json():[]).then(d=>setOrgs(Array.isArray(d)?d:[])).catch(()=>{});
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(d=>setBranches(Array.isArray(d)?d:[])).catch(()=>{});
  }, []);

  // open on the tests still waiting for a result (status Received) without needing a click
  useEffect(() => { if (allowed) load(EMPTY); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = (filters = f) => {
    setLoading(true); setErr(''); setApplied({ stage: filters.stage, test: filters.test });
    const { test, ...rest } = filters;
    const qs = Object.entries({ ...rest, ...splitTestFilter(test) })
      .filter(([,v]) => String(v ?? '') !== '')
      .map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    authedFetch(`/billing/bills${qs?`?${qs}`:''}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { setBills(Array.isArray(d) ? d : []); setPicked(new Set()); setLoading(false); })
      .catch(() => { setBills([]); setLoading(false); });
  };

  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const createBlank = async () => {
    if (picked.size === 0) { setErr('Tick at least one test first.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await authedFetch('/results/blank', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ bill_item_ids: [...picked] }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(errText(e.detail) || 'Could not create the report'); }
      const out = await res.json();
      setMade(out.results || []);
    } catch (e) { setErr(String(e.message || 'Could not create the report')); }
    setBusy(false);
  };

  const sendToOutsource = async () => {
    if (picked.size === 0) { setErr('Tick at least one test first.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await authedFetch('/sample-status/advance', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ item_ids: [...picked], status:'outsource' }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(errText(e.detail) || 'Could not change the status'); }
      const out = await res.json();
      setErr('');
      alert(`${out.updated ?? picked.size} test(s) marked Outsourced. Upload the outside lab's report from the Results page.`);
      load();
    } catch (e) { setErr(String(e.message || 'Could not change the status')); }
    setBusy(false);
  };

  // every billed line across the bills that came back, flattened into one list
  const lines = bills
    .flatMap(b => (b.items || []).map(it => ({ ...it, bill_no: b.bill_no, patient_name: b.patient_name, barcode: b.barcode, bill_status: b.status })))
    // the API matches whole bills; keep only the lines that are themselves at the chosen status / test / group
    .filter(it => !applied.stage || it.status === applied.stage)
    .filter(it => !applied.test || (applied.test.startsWith('p:') ? String(it.package_id) === applied.test.slice(2) : String(it.test_id) === applied.test.slice(2)));

  if (!allowed) {
    return <div style={{ ...S.card }}>
      <div style={{ fontSize:'0.9rem', color:'#475569' }}>Blank reports can only be created by lab admin, technician or pathologist logins.</div>
    </div>;
  }

  return (
    <div>
      <div style={{ marginBottom:'1.3rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', color:'#6366f1', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.5rem' }}>Reports</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Blank Report</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>
          Shows tests received at the lab that have no result yet. Pick one, create its report with every parameter empty, then type the values in. Change Status to see other stages.
        </p>
      </div>

      {/* filters — the same set as the Bills page */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'0.8rem', alignItems:'end' }}>
          <div><label style={lbl}>Organization</label>
            <SearchSelect style={inp} value={f.organization_id} onChange={v=>setF({...f,organization_id:v})}
              emptyLabel="All" placeholder="Type code or name…"
              options={orgs.map(o => ({ value:o.id, label:(o.code && !String(o.name||'').toUpperCase().startsWith(String(o.code).trim().toUpperCase())) ? `${o.code} - ${o.name}` : o.name }))
                .sort((a,b)=>a.label.localeCompare(b.label))} /></div>
          <div><label style={lbl}>Branch</label>
            <select style={inp} value={f.branch_id} onChange={e=>setF({...f,branch_id:e.target.value})}>
              <option value="">All</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div><label style={lbl}>From</label><input style={inp} type="date" value={f.date_from} onChange={e=>setF({...f,date_from:e.target.value})} /></div>
          <div><label style={lbl}>To</label><input style={inp} type="date" value={f.date_to} onChange={e=>setF({...f,date_to:e.target.value})} /></div>
          <div><label style={lbl}>Patient Name</label><input style={inp} placeholder="name" value={f.patient_name} onChange={e=>setF({...f,patient_name:e.target.value})} onKeyDown={e=>{ if (e.key==='Enter') load(); }} /></div>
          <div><label style={lbl}>Patient ID</label><input style={inp} placeholder="id" value={f.patient_id} onChange={e=>setF({...f,patient_id:e.target.value})} onKeyDown={e=>{ if (e.key==='Enter') load(); }} /></div>
          <div><label style={lbl}>Barcode</label><input style={inp} placeholder="barcode" value={f.barcode} onChange={e=>setF({...f,barcode:e.target.value})} onKeyDown={e=>{ if (e.key==='Enter') load(); }} /></div>
          <TestFilter style={inp} value={f.test} onChange={v=>setF({...f,test:v})} />
          <div><label style={lbl}>Status</label>
            <select style={inp} value={f.stage} onChange={e=>setF({...f,stage:e.target.value})}>
              {STAGES.map(s => <option key={s} value={s}>{s ? s[0].toUpperCase()+s.slice(1).replace('_',' ') : 'All'}</option>)}
            </select></div>
        </div>
        <div style={{ display:'flex', gap:'0.6rem', marginTop:'1rem', flexWrap:'wrap', alignItems:'center' }}>
          <button onClick={()=>load()} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.4rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Apply Filters</button>
          <button onClick={()=>{ setF(EMPTY); setBills([]); setMade([]); }} style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 1.2rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Clear</button>
        </div>
      </div>

      {err && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', borderRadius:'10px', padding:'0.7rem 0.9rem', marginBottom:'1rem', fontSize:'0.82rem' }}>{err}</div>}

      {/* the billed tests that came back */}
      <div style={{ ...S.card, padding:0, overflow:'hidden', marginBottom:'1.2rem' }}>
        <div style={{ padding:'0.9rem 1.2rem', borderBottom:'1px solid #e8ecf4', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.7rem', flexWrap:'wrap' }}>
          <div style={{ fontSize:'0.84rem', fontWeight:700, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
            {loading ? 'Searching…' : `${lines.length} billed test(s)`}{picked.size > 0 ? ` · ${picked.size} selected` : ''}
          </div>
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
            <button onClick={createBlank} disabled={busy || picked.size === 0}
              style={{ background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.1rem', fontWeight:700, cursor: picked.size ? 'pointer' : 'not-allowed', opacity: picked.size ? 1 : 0.5, fontFamily:'Manrope,sans-serif' }}>
              {busy ? '…' : '＋ Create Blank Report'}
            </button>
            <button onClick={sendToOutsource} disabled={busy || picked.size === 0}
              title="Send these tests to an external lab instead of testing in-house"
              style={{ background:'#fff', color:'#7c3aed', border:'1.5px solid rgba(124,58,237,0.5)', borderRadius:'9px', padding:'0.55rem 1.1rem', fontWeight:700, cursor: picked.size ? 'pointer' : 'not-allowed', opacity: picked.size ? 1 : 0.5, fontFamily:'Manrope,sans-serif' }}>
              📤 Outsource
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div style={{ padding:'2rem 1.2rem', textAlign:'center', color:'#8892a4', fontSize:'0.85rem' }}>
            {loading ? '' : 'No billed tests match. Set the filters above and press Apply Filters.'}
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#fafbfc' }}>
                  {['', 'Test', 'Group', 'Patient', 'Barcode', 'Accession', 'Bill', 'Status'].map((h,i) => (
                    <th key={i} style={{ padding:'0.6rem 0.9rem', textAlign:'left', fontSize:'0.64rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', borderBottom:'1px solid #e8ecf4' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(it => (
                  <tr key={it.id} onClick={()=>toggle(it.id)}
                    style={{ cursor:'pointer', background: picked.has(it.id) ? '#fff7ed' : '#fff' }}>
                    <td style={{ padding:'0.55rem 0.9rem', borderBottom:'1px solid #f4f6fa' }}>
                      <input type="checkbox" readOnly checked={picked.has(it.id)} style={{ accentColor:'#f97316', width:'15px', height:'15px' }} />
                    </td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.82rem', color:'#0f1218', fontWeight:600, borderBottom:'1px solid #f4f6fa' }}>{it.test_name}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.76rem', color:'#8892a4', borderBottom:'1px solid #f4f6fa' }}>{it.package_name || '—'}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.8rem', color:'#0f1218', borderBottom:'1px solid #f4f6fa' }}>{it.patient_name || '—'}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.76rem', color:'#c2410c', fontFamily:'monospace', borderBottom:'1px solid #f4f6fa' }}>{it.barcode || '—'}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.76rem', color:'#8892a4', fontFamily:'monospace', borderBottom:'1px solid #f4f6fa' }}>{it.accession_number || '—'}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.76rem', color:'#8892a4', borderBottom:'1px solid #f4f6fa' }}>{it.bill_no}</td>
                    <td style={{ padding:'0.55rem 0.9rem', fontSize:'0.74rem', borderBottom:'1px solid #f4f6fa' }}>
                      <span style={{ background:'rgba(136,146,164,0.12)', color:'#475569', padding:'0.15rem 0.55rem', borderRadius:'20px', fontWeight:700 }}>{it.status || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* the reports just created, each editable and saved on its own */}
      {made.length > 0 && (
        <div style={{ ...S.card }}>
          <div style={{ fontSize:'0.9rem', fontWeight:800, color:'#0f1218', fontFamily:'Manrope,sans-serif', marginBottom:'0.2rem' }}>Fill in the values</div>
          <div style={{ fontSize:'0.76rem', color:'#8892a4', marginBottom:'1rem' }}>
            {made.length} report(s) ready — each one saves on its own. Leave a parameter blank and it stays off the printed report.
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.9rem' }}>
            {made.map(r => (
              <div key={r.id} style={{ border:'1px solid #e8ecf4', borderRadius:'11px', overflow:'hidden' }}>
                <div style={{ padding:'0.7rem 0.95rem', background:'#fafbfc', borderBottom:'1px solid #e8ecf4' }}>
                  <div style={{ fontSize:'0.84rem', fontWeight:700, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
                    {r.patient_name || '—'} <span style={{ fontFamily:'monospace', color:'#c2410c' }}>{r.barcode || '—'}</span>
                  </div>
                  <div style={{ fontSize:'0.7rem', color:'#8892a4', marginTop:'0.15rem' }}>{r.test_name} · {r.accession_number || '—'}</div>
                </div>
                <div style={{ padding:'0.9rem' }}>
                  <ResultEditor result={r} onSaved={updated => setMade(prev => prev.map(x => x.id === r.id
                    ? { ...x, parsed_data: updated.parsed_data, note: updated.note } : x))} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
