import { useState, useRef, useEffect } from 'react';
import { authedFetch } from '../services/auth';
import DepartmentSelect from '../components/DepartmentSelect';

const STATUSES = ['collected', 'received', 'tested', 'validated', 'reported', 'outsource', 'sample_rejected'];
const NEXT = ['collected', 'received', 'tested', 'validated', 'reported'];
const STATUS_COLOR = {
  collected:'#0ea5e9', received:'#8b5cf6',
  tested:'#f59e0b', validated:'#16a34a', reported:'#0f766e',
  outsource:'#7c3aed', sample_rejected:'#dc2626',
};

const TODAY = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);

async function j(path, method = 'GET', body) {
  const opts = { method };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await authedFetch(path, opts);
  if (!r.ok) { let m = 'Request failed (' + r.status + ')'; try { const e = await r.json(); if (typeof e.detail === 'string') m = e.detail; } catch {} throw new Error(m); }
  return r.json();
}

export default function ChangeStatus() {
  const [tab, setTab] = useState('search');   // 'search' | 'scan'
  const [f, setF] = useState({ patient_id: '', barcode: '', accession_number: '', branch_id: '', franchise_id: '', status: '', date_from: TODAY, date_to: TODAY, organization_id: '', department_id: '' });
  const [orgs, setOrgs] = useState([]);
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);   // {msg, kind:'success'|'warn'}

  const showToast = (msg, kind='success') => { setToast({ msg, kind }); setTimeout(()=>setToast(null), 3500); };

  const search = async () => {
    setErr(''); setBusy(true); setSel(new Set());
    const qs = new URLSearchParams();
    if (f.patient_id) qs.set('patient_id', f.patient_id);
    if (f.barcode) qs.set('barcode', f.barcode);
    if (f.accession_number) qs.set('accession_number', f.accession_number);
    if (f.branch_id) qs.set('branch_id', f.branch_id);
    if (f.franchise_id) qs.set('franchise_id', f.franchise_id);
    if (f.status) qs.set('status', f.status);
    if (f.date_from) qs.set('date_from', f.date_from);
    if (f.date_to) qs.set('date_to', f.date_to);
    if (f.organization_id) qs.set('organization_id', f.organization_id);
    if (f.department_id) qs.set('department_id', f.department_id);
    try { setRows(await j('/sample-status/search?' + qs.toString())); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // opens on today's samples, like Results / Bills
  useEffect(() => {
    search();
    authedFetch('/b2b/organizations').then(r => r.ok ? r.json() : []).then(d => setOrgs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);   // eslint-disable-line

  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const toggleAll = () => {
    if (!rows) return;
    setSel(sel.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  };

  const advance = async (status) => {
    if (sel.size === 0) { setErr('Select at least one sample first.'); return; }
    setErr(''); setBusy(true);
    try {
      const res = await j('/sample-status/advance', 'POST', { item_ids: [...sel], status });
      await search();
      const isReject = status === 'sample_rejected';
      showToast(
        `${res.updated} test(s) → ${isReject ? 'Rejected ⚠' : status}`,
        isReject ? 'warn' : 'success'
      );
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // ---- Scan Mode ----
  const [scanCode, setScanCode] = useState('');
  const [scanLog, setScanLog] = useState([]);   // most-recent-first log of scan results
  const [scanBusy, setScanBusy] = useState(false);
  const scanInputRef = useRef(null);

  useEffect(() => { if (tab === 'scan') scanInputRef.current?.focus(); }, [tab]);

  // A barcode scanner just "types" the code and presses Enter, so it only works if
  // the text box has the cursor. While Scan Mode is open, a keystroke that lands
  // anywhere else on the page (the box lost focus after a click, a button, the
  // sidebar) is handed to the box, so scanning never depends on clicking it first.
  const scanCodeRef = useRef('');
  const doScanRef = useRef(null);
  useEffect(() => {
    if (tab !== 'scan') return;
    const onKey = (e) => {
      const box = scanInputRef.current;
      if (!box || document.activeElement === box) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (!scanCodeRef.current.trim()) return;
        e.preventDefault(); box.focus(); doScanRef.current && doScanRef.current(scanCodeRef.current);
      } else if (e.key.length === 1) {
        e.preventDefault(); box.focus();
        scanCodeRef.current += e.key; setScanCode(scanCodeRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  const doScan = async (override) => {
    const code = (typeof override === 'string' ? override : scanCode).trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    try {
      const res = await j('/sample-status/scan', 'POST', { code });
      const entry = { code, time: new Date(), matched_by: res.matched_by, updated: res.updated, skipped: res.skipped };
      setScanLog(l => [entry, ...l].slice(0, 50));
    } catch (e) {
      setScanLog(l => [{ code, time: new Date(), error: e.message }, ...l].slice(0, 50));
    }
    setScanCode(''); scanCodeRef.current = '';
    setScanBusy(false);
    setTimeout(() => scanInputRef.current?.focus(), 0);   // after the box is enabled again
  };
  doScanRef.current = doScan;

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='warn'?'#f97316':'#16a34a'}` }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='warn'?'rgba(249,115,22,0.12)':'rgba(22,163,74,0.12)' }}>{toast.kind==='warn'?'⚠':'✓'}</div>
          <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}
      <h1 style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218', margin: 0 }}>Change Report Status</h1>
      <p style={{ fontSize: '0.82rem', color: '#8892a4', margin: '0.3rem 0 1rem' }}>
        Search per test/sample (by accession number, barcode, patient, branch, or franchise), tick the ones you want, then advance: collected → received → tested → validated → reported
      </p>

      {/* tabs */}
      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.2rem', borderBottom:'1px solid #e8ecf4' }}>
        {[['search','🔎 Search'], ['scan','📷 Scan Mode']].map(([k,label]) => (
          <button key={k} onClick={()=>setTab(k)}
            style={{ padding:'0.6rem 1.1rem', border:'none', background:'transparent', cursor:'pointer', fontFamily:'Manrope,sans-serif', fontWeight:700, fontSize:'0.84rem',
                     color: tab===k?'#f97316':'#8892a4', borderBottom: tab===k?'2px solid #f97316':'2px solid transparent', marginBottom:'-1px' }}>{label}</button>
        ))}
      </div>

      {tab === 'scan' ? (
        <div>
          <div style={{ ...card, marginBottom:'1rem' }}>
            <div style={lbl}>Scan barcode / accession label</div>
            <div style={{ display:'flex', gap:'0.6rem' }}>
              <input ref={scanInputRef} autoFocus style={{ ...inp, fontFamily:'monospace', fontSize:'1.1rem', letterSpacing:'0.04em' }}
                placeholder="Scan or type a code, then press Enter…" value={scanCode}
                onChange={e=>{ setScanCode(e.target.value); scanCodeRef.current = e.target.value; }}
                onKeyDown={e=>{ if (e.key==='Enter') doScan(); }} onBlur={()=>{ if (tab==='scan' && !scanBusy) setTimeout(()=>{ const a=document.activeElement; if (!a || a===document.body) scanInputRef.current?.focus(); }, 0); }} disabled={scanBusy} />
              <button onClick={()=>doScan()} disabled={scanBusy || !scanCode.trim()} style={btnPrimary}>{scanBusy?'…':'Receive'}</button>
            </div>
            <div style={{ fontSize:'0.74rem', color:'#8892a4', marginTop:'0.6rem' }}>
              Every scan moves that sample straight to <b>Received</b> — but only if it's currently <b>Collected</b>. Anything already further along (tested, validated, reported, rejected) is left untouched and reported below instead of being changed.
            </div>
          </div>

          {scanLog.length > 0 && (
            <div style={card}>
              <div style={{ fontSize:'0.68rem', fontWeight:700, color:'#8892a4', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.7rem' }}>Scan log</div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {scanLog.map((e, i) => (
                  <div key={i} style={{ padding:'0.6rem 0.8rem', borderRadius:9, background:'#fafbfc', border:'1px solid #f1f5f9', fontSize:'0.82rem' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontFamily:'monospace', fontWeight:700, color:'#0f1218' }}>{e.code}</span>
                      <span style={{ fontSize:'0.7rem', color:'#94a3b8' }}>{e.time.toLocaleTimeString()}</span>
                    </div>
                    {e.error && <div style={{ color:'#dc2626', marginTop:'0.25rem' }}>✕ {e.error}</div>}
                    {!e.error && e.updated?.map(u => (
                      <div key={u.id} style={{ color:'#16a34a', marginTop:'0.25rem' }}>
                        ✓ {u.test_name} ({u.accession_number}) — {u.patient_name}: {u.prev_status} → <b>{u.new_status}</b>
                      </div>
                    ))}
                    {!e.error && e.skipped?.map(s => (
                      <div key={s.id} style={{ color:'#c2410c', marginTop:'0.25rem' }}>
                        — {s.test_name} ({s.accession_number}) — already <b>{s.status}</b>, not changed
                      </div>
                    ))}
                    {!e.error && e.matched_by && (
                      <div style={{ color:'#94a3b8', fontSize:'0.72rem', marginTop:'0.2rem' }}>
                        matched by {e.matched_by === 'accession' ? 'accession number' : "patient's barcode (all collected tests received)"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
      <>
      {/* filters */}
      <div style={card}>
        <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 140 }}>
            <div style={lbl}>From</div>
            <input type="date" style={inp} value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} />
          </div>
          <div style={{ minWidth: 140 }}>
            <div style={lbl}>To</div>
            <input type="date" style={inp} value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} />
          </div>
          {orgs.length > 0 && (
            <div style={{ minWidth: 160 }}>
              <div style={lbl}>Organization</div>
              <select style={inp} value={f.organization_id} onChange={e => setF({ ...f, organization_id: e.target.value })}>
                <option value="">All</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ minWidth: 150 }}>
            <DepartmentSelect style={inp} labelStyle={lbl} value={f.department_id} onChange={v => setF({ ...f, department_id: v })} />
          </div>
          <Field label="Patient ID" value={f.patient_id} onChange={v => setF({ ...f, patient_id: v })} />
          <Field label="Barcode" value={f.barcode} onChange={v => setF({ ...f, barcode: v })} />
          <Field label="Accession No." value={f.accession_number} onChange={v => setF({ ...f, accession_number: v })} />
          <Field label="Branch ID" value={f.branch_id} onChange={v => setF({ ...f, branch_id: v })} />
          <Field label="Franchise ID" value={f.franchise_id} onChange={v => setF({ ...f, franchise_id: v })} />
          <div style={{ minWidth: 130 }}>
            <div style={lbl}>Status</div>
            <select style={inp} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              <option value="">Any</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={search} disabled={busy} style={btnPrimary}>{busy ? '…' : 'Search'}</button>
        </div>
      </div>

      {err && <div style={errBox}>{err}</div>}

      {rows && (
        <div style={{ ...card, marginTop: '1rem' }}>
          {/* advance toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#8892a4', fontWeight: 700 }}>{sel.size} selected · advance to:</span>
            {NEXT.map(s => (
              <button key={s} onClick={() => advance(s)} disabled={busy || sel.size === 0}
                style={{ ...btnStatus, background: STATUS_COLOR[s], opacity: sel.size === 0 ? 0.45 : 1 }}>{s}</button>
            ))}
            <div style={{ marginLeft: 'auto', display:'flex', gap:'0.5rem' }}>
              <button onClick={() => advance('outsource')} disabled={busy || sel.size === 0}
                style={{ ...btnStatus, background: STATUS_COLOR.outsource, opacity: sel.size === 0 ? 0.45 : 1, display:'flex', alignItems:'center', gap:'0.3rem' }} title="Send to an external/reference lab instead of testing in-house">📤 Outsource</button>
              <button onClick={() => advance('sample_rejected')} disabled={busy || sel.size === 0}
                style={{ ...btnStatus, background: '#dc2626', opacity: sel.size === 0 ? 0.45 : 1, display:'flex', alignItems:'center', gap:'0.3rem' }}>⚠ Reject Sample</button>
            </div>
          </div>

          {rows.length === 0 ? <div style={{ color: '#8892a4', fontSize: '0.85rem', padding: '0.5rem' }}>No samples match.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8892a4', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.4rem' }}><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} /></th>
                  <th style={th}>Patient</th><th style={th}>Barcode</th><th style={th}>Test</th><th style={th}>Department</th><th style={th}>Accession No.</th><th style={th}>Bill No.</th><th style={th}>Status</th><th style={th}>Result?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem 0.4rem' }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td style={td}>{r.patient_name} <span style={{ color: '#94a3b8' }}>#{r.patient_id}</span></td>
                    <td style={{ ...td, color: '#f97316', fontWeight: 700 }}>{r.barcode}</td>
                    <td style={td}>
                      {r.package_name && (
                        <div style={{ fontSize:'0.6rem', fontWeight:700, color:'#c2410c', background:'rgba(249,115,22,0.1)', display:'inline-block', padding:'0.08rem 0.4rem', borderRadius:20, marginBottom:'0.15rem' }}>{r.package_name}</div>
                      )}
                      <div>{r.test_name}</div>
                    </td>
                    <td style={{ ...td, color:'#0e7490', fontWeight:600 }}>{r.department || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#c2410c' }}>{r.accession_number || '—'}</td>
                    <td style={{ ...td, color:'#8892a4' }}>{r.bill_no}</td>
                    <td style={td}><span style={{ ...pill, background: (STATUS_COLOR[r.status] || '#94a3b8') + '22', color: STATUS_COLOR[r.status] || '#94a3b8' }}>{r.status}</span></td>
                    <td style={td}>{r.has_result ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={lbl}>{label}</div>
      <input style={inp} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

const card = { background: '#fff', border: '1px solid #e8ecf4', borderRadius: 14, padding: '1.1rem 1.3rem', boxShadow: '0 1px 8px rgba(15,18,24,0.04)' };
const lbl = { fontSize: '0.68rem', fontWeight: 700, color: '#8892a4', marginBottom: '0.25rem' };
const inp = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid #e8ecf4', fontSize: '0.84rem', boxSizing: 'border-box' };
const th = { padding: '0.4rem' };
const td = { padding: '0.5rem 0.4rem', color: '#0f1218' };
const pill = { fontSize: '0.66rem', fontWeight: 800, padding: '0.15rem 0.55rem', borderRadius: 100, textTransform: 'capitalize' };
const btnPrimary = { padding: '0.5rem 1.1rem', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: '#fff', background: 'linear-gradient(135deg,#f97316,#fbbf24)' };
const btnStatus = { padding: '0.4rem 0.8rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.74rem', color: '#fff', textTransform: 'capitalize' };
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.8rem', padding: '0.6rem 0.9rem', borderRadius: 9, marginTop: '1rem' };
