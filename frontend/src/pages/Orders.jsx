import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const FLOW = ['collected', 'dispatched', 'received', 'test_started', 'resulted', 'validated', 'reported'];
const COLLECTION_STEPS = [
  ['collected', 'Collected'], ['dispatched', 'Dispatched'],
  ['received', 'Received'], ['test_started', 'Start Testing'],
];
const FLAG_COLOR = { critical: '#dc2626', high: '#ea580c', low: '#2563eb', normal: '#16a34a' };
const STATUS_COLOR = { created:'#8892a4', collected:'#0ea5e9', received:'#6366f1', testing:'#f59e0b',
                       resulted:'#8b5cf6', validated:'#16a34a', reported:'#0f766e', cancelled:'#ef4444' };

async function j(path, method = 'GET', body) {
  const opts = { method };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await authedFetch(path, opts);
  if (!r.ok) { let m = 'Request failed (' + r.status + ')'; try { const e = await r.json(); if (typeof e.detail === 'string') m = e.detail; } catch {} throw new Error(m); }
  return r.json();
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const refresh = () => j('/orders').then(setOrders).catch(e => setErr(e.message));
  useEffect(() => { refresh(); }, []);

  const open = (id) => j('/orders/' + id, 'GET').then(setSel).catch(e => setErr(e.message));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218', margin: 0 }}>Orders & Worklist</h1>
          <p style={{ fontSize: '0.82rem', color: '#8892a4', margin: '0.3rem 0 0' }}>Register → collect → test → validate → release</p>
        </div>
        <button onClick={() => setCreating(true)} style={btnPrimary}>+ New Order</button>
      </div>

      {err && <div style={errBox}>{err}</div>}
      {creating && <NewOrder onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} setErr={setErr} />}

      <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-start' }}>
        {/* list */}
        <div style={{ flex: '0 0 340px' }}>
          {orders.length === 0 && <div style={{ color: '#8892a4', fontSize: '0.85rem', padding: '1rem' }}>No orders yet.</div>}
          {orders.map(o => (
            <div key={o.id} onClick={() => open(o.id)} style={{ ...listItem, ...(sel && sel.id === o.id ? { borderColor: '#f97316', background: '#fff7ed' } : {}) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f1218' }}>{o.order_no || ('#' + o.id)}</span>
                <span style={{ ...badge, background: (STATUS_COLOR[o.status] || '#8892a4') + '22', color: STATUS_COLOR[o.status] || '#8892a4' }}>{o.status}</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#8892a4', marginTop: '0.25rem' }}>
                {o.barcode || '—'} · {o.items.length} test(s){o.priority === 'stat' ? ' · STAT' : ''}
              </div>
            </div>
          ))}
        </div>

        {/* detail */}
        <div style={{ flex: 1 }}>
          {!sel ? <div style={{ ...card, color: '#8892a4', fontSize: '0.85rem' }}>Select an order to work on it.</div>
                : <Detail order={sel} reload={() => { open(sel.id); refresh(); }} setErr={setErr} />}
        </div>
      </div>
    </div>
  );
}

function Detail({ order, reload, setErr }) {
  const done = new Set((order.events || []).map(e => e.event_type));
  const act = (fn) => fn().then(reload).catch(e => setErr(e.message));

  const recordEvent = (type) => act(() => j('/orders/' + order.id + '/events', 'POST', { event_type: type }));
  const validate = () => act(() => j('/orders/' + order.id + '/validate', 'POST', {}));
  const release  = () => act(() => j('/orders/' + order.id + '/release', 'POST', {}));

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f1218' }}>{order.order_no || ('Order #' + order.id)}</div>
        <span style={{ ...badge, background: (STATUS_COLOR[order.status] || '#8892a4') + '22', color: STATUS_COLOR[order.status] || '#8892a4', fontSize: '0.7rem' }}>{order.status}</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#8892a4', margin: '0.3rem 0 1rem' }}>
        Barcode {order.barcode || '—'} · Patient #{order.patient_id || '—'} · {order.referring_doctor || 'no referrer'}
      </div>

      {/* lifecycle stepper */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {FLOW.map(s => (
          <span key={s} style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: 100,
                                 background: done.has(s) ? '#16a34a22' : '#f1f5f9', color: done.has(s) ? '#16a34a' : '#94a3b8' }}>
            {done.has(s) ? '✓ ' : ''}{s.replace('_', ' ')}
          </span>
        ))}
      </div>

      {/* collection-side actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
        {COLLECTION_STEPS.map(([type, label]) => (
          <button key={type} disabled={done.has(type)} onClick={() => recordEvent(type)}
            style={done.has(type) ? btnGhostDone : btnGhost}>{done.has(type) ? '✓ ' : ''}{label}</button>
        ))}
      </div>

      {/* items + result entry */}
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Tests</div>
      {order.items.map(it => <ResultRow key={it.id} order={order} item={it} reload={reload} setErr={setErr} />)}

      {/* validate / release */}
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem', borderTop: '1px solid #eef2f7', paddingTop: '1rem' }}>
        <button onClick={validate} style={btnPrimary}>Validate &amp; Sign</button>
        <button onClick={release} style={btnDark}>Release Report</button>
      </div>
    </div>
  );
}

function ResultRow({ order, item, reload, setErr }) {
  const [val, setVal] = useState(item.result_value || '');
  const save = () => j('/orders/' + order.id + '/items/' + item.id + '/result', 'PUT', { result_value: val })
    .then(res => { reload(); if (res.critical) alert('⚠ CRITICAL value for ' + item.test_name + ': ' + res.result_value); })
    .catch(e => setErr(e.message));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderBottom: '1px solid #f4f6fa' }}>
      <div style={{ flex: 1, fontSize: '0.85rem', color: '#0f1218' }}>{item.test_name}</div>
      {item.flag && <span style={{ fontSize: '0.62rem', fontWeight: 800, color: FLAG_COLOR[item.flag] || '#8892a4', textTransform: 'uppercase' }}>{item.flag}</span>}
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="result"
             style={{ width: 90, padding: '0.35rem 0.5rem', borderRadius: 8, border: '1px solid #e8ecf4', fontSize: '0.82rem' }} />
      <button onClick={save} style={btnSmall}>Save</button>
    </div>
  );
}

function NewOrder({ onClose, onCreated, setErr }) {
  const [f, setF] = useState({ patient_id: '', barcode: '', order_no: '', priority: 'routine', tests: '' });
  const submit = () => {
    const items = f.tests.split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ test_name: t, price: 0 }));
    if (!items.length) { setErr('Add at least one test (one per line).'); return; }
    j('/orders', 'POST', {
      patient_id: f.patient_id ? Number(f.patient_id) : null,
      barcode: f.barcode || null, order_no: f.order_no || null, priority: f.priority, items,
    }).then(onCreated).catch(e => setErr(e.message));
  };
  const inp = { width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #e8ecf4', fontSize: '0.85rem', boxSizing: 'border-box', marginTop: '0.25rem' };
  const lbl = { fontSize: '0.7rem', fontWeight: 700, color: '#8892a4' };
  return (
    <div style={{ ...card, marginBottom: '1.2rem' }}>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}><div style={lbl}>Patient ID</div><input style={inp} value={f.patient_id} onChange={e => setF({ ...f, patient_id: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 120 }}><div style={lbl}>Barcode</div><input style={inp} value={f.barcode} onChange={e => setF({ ...f, barcode: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 120 }}><div style={lbl}>Order No</div><input style={inp} value={f.order_no} onChange={e => setF({ ...f, order_no: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 120 }}><div style={lbl}>Priority</div>
          <select style={inp} value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}><option value="routine">Routine</option><option value="stat">STAT</option></select>
        </div>
      </div>
      <div style={{ marginTop: '0.7rem' }}><div style={lbl}>Tests (one per line)</div>
        <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={f.tests} onChange={e => setF({ ...f, tests: e.target.value })} placeholder={'Complete Blood Count\nHbA1c'} />
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
        <button onClick={submit} style={btnPrimary}>Create Order</button>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
      </div>
    </div>
  );
}

const card = { background: '#fff', border: '1px solid #e8ecf4', borderRadius: 14, padding: '1.1rem 1.3rem', boxShadow: '0 1px 8px rgba(15,18,24,0.04)' };
const listItem = { background: '#fff', border: '1px solid #e8ecf4', borderRadius: 11, padding: '0.7rem 0.9rem', marginBottom: '0.6rem', cursor: 'pointer' };
const badge = { fontSize: '0.62rem', fontWeight: 800, padding: '0.15rem 0.55rem', borderRadius: 100, textTransform: 'capitalize' };
const btnPrimary = { padding: '0.5rem 1rem', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: '#fff', background: 'linear-gradient(135deg,#f97316,#fbbf24)' };
const btnDark = { padding: '0.5rem 1rem', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: '#fff', background: '#1a1f2e' };
const btnGhost = { padding: '0.45rem 0.8rem', borderRadius: 9, border: '1px solid #e8ecf4', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', color: '#475569', background: '#fff' };
const btnGhostDone = { ...btnGhost, color: '#16a34a', borderColor: '#bbf7d0', background: '#f0fdf4', cursor: 'default' };
const btnSmall = { padding: '0.35rem 0.7rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.76rem', color: '#fff', background: '#f97316' };
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.8rem', padding: '0.6rem 0.9rem', borderRadius: 9, marginBottom: '1rem' };
