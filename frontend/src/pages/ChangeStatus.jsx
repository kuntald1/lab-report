import { useState } from 'react';
import { authedFetch } from '../services/auth';

const STATUSES = ['collected', 'dispatched', 'received', 'tested', 'validated', 'reported'];
const NEXT = ['dispatched', 'received', 'tested', 'validated', 'reported'];
const STATUS_COLOR = {
  collected:'#0ea5e9', dispatched:'#6366f1', received:'#8b5cf6',
  tested:'#f59e0b', validated:'#16a34a', reported:'#0f766e',
};

async function j(path, method = 'GET', body) {
  const opts = { method };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await authedFetch(path, opts);
  if (!r.ok) { let m = 'Request failed (' + r.status + ')'; try { const e = await r.json(); if (typeof e.detail === 'string') m = e.detail; } catch {} throw new Error(m); }
  return r.json();
}

export default function ChangeStatus() {
  const [f, setF] = useState({ patient_id: '', barcode: '', branch_id: '', franchise_id: '', status: '' });
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setErr(''); setBusy(true); setSel(new Set());
    const qs = new URLSearchParams();
    if (f.patient_id) qs.set('patient_id', f.patient_id);
    if (f.barcode) qs.set('barcode', f.barcode);
    if (f.branch_id) qs.set('branch_id', f.branch_id);
    if (f.franchise_id) qs.set('franchise_id', f.franchise_id);
    if (f.status) qs.set('status', f.status);
    try { setRows(await j('/sample-status/search?' + qs.toString())); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const toggleAll = () => {
    if (!rows) return;
    setSel(sel.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  };

  const advance = async (status) => {
    if (sel.size === 0) { setErr('Select at least one sample first.'); return; }
    setErr(''); setBusy(true);
    try {
      const res = await j('/sample-status/advance', 'POST', { patient_ids: [...sel], status });
      await search();
      alert(`${res.updated} sample(s) → ${status}`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218', margin: 0 }}>Change Report Status</h1>
      <p style={{ fontSize: '0.82rem', color: '#8892a4', margin: '0.3rem 0 1.2rem' }}>
        Search samples, tick the ones you want, then advance: collected → dispatched → received → tested → validated → reported
      </p>

      {/* filters */}
      <div style={card}>
        <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Patient ID" value={f.patient_id} onChange={v => setF({ ...f, patient_id: v })} />
          <Field label="Barcode" value={f.barcode} onChange={v => setF({ ...f, barcode: v })} />
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
          </div>

          {rows.length === 0 ? <div style={{ color: '#8892a4', fontSize: '0.85rem', padding: '0.5rem' }}>No samples match.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8892a4', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.4rem' }}><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} /></th>
                  <th style={th}>Patient</th><th style={th}>Barcode</th><th style={th}>Status</th><th style={th}>Result?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem 0.4rem' }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td style={td}>{r.patient_name} <span style={{ color: '#94a3b8' }}>#{r.id}</span></td>
                    <td style={{ ...td, color: '#f97316', fontWeight: 700 }}>{r.barcode}</td>
                    <td style={td}><span style={{ ...pill, background: (STATUS_COLOR[r.status] || '#94a3b8') + '22', color: STATUS_COLOR[r.status] || '#94a3b8' }}>{r.status}</span></td>
                    <td style={td}>{r.has_result ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
