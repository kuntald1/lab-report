import { useEffect, useState, useCallback } from 'react';
import { authedFetch } from '../services/auth';

const STAGE_META = {
  wait_for_pickup:      { label: 'Wait for pickup',  color: '#E24B4A' },
  transit:              { label: 'Transit',          color: '#E8A33D' },
  receipt_accessioning: { label: 'Receipt + accessioning', color: '#378ADD' },
  testing:              { label: 'Testing',          color: '#1D9E75' },
  validation:           { label: 'Validation',       color: '#7F77DD' },
  reporting:            { label: 'Reporting',        color: '#888780' },
};

const fmt = (m) => {
  if (m == null) return '—';
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
};

const EMPTY = { franchise_id: '', branch_id: '', date_from: '', date_to: '', patient_id: '', barcode: '' };

export default function TAT() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  // form = what's typed in the bar; applied only changes when the user hits Apply
  const [form, setForm] = useState(EMPTY);

  const load = useCallback((f) => {
    setLoading(true);
    setErr('');
    const qs = new URLSearchParams();
    if (f.franchise_id) qs.set('franchise_id', f.franchise_id);
    if (f.branch_id)    qs.set('branch_id', f.branch_id);
    if (f.date_from)    qs.set('date_from', f.date_from);
    if (f.date_to)      qs.set('date_to', f.date_to);
    if (f.patient_id)   qs.set('patient_id', f.patient_id);
    if (f.barcode)      qs.set('barcode', f.barcode.trim());
    const url = '/tat/by-franchise' + (qs.toString() ? `?${qs}` : '');
    authedFetch(url)
      .then(r => { if (!r.ok) throw new Error('Failed to load TAT (' + r.status + ')'); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(EMPTY); }, [load]);

  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));
  const apply = () => load(form);
  const reset = () => { setForm(EMPTY); load(EMPTY); };

  const frOpts = (data && data.filters && data.filters.franchises) || [];
  const brOpts = (data && data.filters && data.filters.branches) || [];
  const hasFilters = Object.values(form).some(v => v !== '');

  return (
    <div>
      <div style={{ marginBottom: '1.2rem' }}>
        <h1 style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218', margin: 0 }}>
          Turnaround Time
        </h1>
        <p style={{ fontSize: '0.82rem', color: '#8892a4', margin: '0.3rem 0 0' }}>
          Median per stage, by franchise
          {data && data.window ? ` · ${data.window.from.slice(0, 10)} → ${data.window.to.slice(0, 10)}` : ''}
        </p>
      </div>

      {/* ---------- filter bar ---------- */}
      <div style={filterBar}>
        <Field label="Franchise">
          <select value={form.franchise_id} onChange={set('franchise_id')} style={input}>
            <option value="">All franchises</option>
            {frOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="Branch">
          <select value={form.branch_id} onChange={set('branch_id')} style={input}>
            <option value="">All branches</option>
            {brOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={form.date_from} onChange={set('date_from')} style={input} />
        </Field>
        <Field label="To">
          <input type="date" value={form.date_to} onChange={set('date_to')} style={input} />
        </Field>
        <Field label="Patient ID">
          <input type="number" placeholder="e.g. 42" value={form.patient_id} onChange={set('patient_id')}
                 style={{ ...input, width: 110 }} />
        </Field>
        <Field label="Barcode">
          <input type="text" placeholder="e.g. 007515926SD" value={form.barcode} onChange={set('barcode')}
                 onKeyDown={e => e.key === 'Enter' && apply()} style={{ ...input, width: 160 }} />
        </Field>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <button onClick={apply} style={btnPrimary}>Apply</button>
          <button onClick={reset} disabled={!hasFilters} style={{ ...btnGhost, opacity: hasFilters ? 1 : 0.5 }}>
            Reset
          </button>
        </div>
      </div>

      {/* shared legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', marginBottom: '1.2rem' }}>
        {Object.keys(STAGE_META).map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#8892a4' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: STAGE_META[s].color }} />
            {STAGE_META[s].label}
          </span>
        ))}
      </div>

      {/* ---------- body ---------- */}
      {loading ? (
        <Msg text="Loading turnaround-time report…" />
      ) : err ? (
        <Msg text={err} error />
      ) : !data || !data.franchises.length ? (
        <Msg text={hasFilters
          ? 'No turnaround-time data matches these filters. Try widening the date range or clearing a filter.'
          : 'No turnaround-time data yet. Orders with sample events will appear here.'} />
      ) : (
        <Report data={data} />
      )}
    </div>
  );
}

function Report({ data }) {
  const stageOrder = data.stage_order;
  const maxTotal = Math.max(...data.franchises.map(f => (f.total && f.total.median) || 0), 1);

  return (
    <>
      {data.franchises.map(f => {
        const total = (f.total && f.total.median) || 0;
        const widthPct = (total / maxTotal) * 100;
        return (
          <div key={f.franchise_id ?? 'direct'} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.7rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#0f1218' }}>{f.franchise_name}</div>
              <div style={{ fontSize: '0.8rem', color: '#8892a4' }}>
                <b style={{ color: '#0f1218' }}>{fmt(total)}</b> total · {f.order_count} orders
              </div>
            </div>

            {/* stacked bar */}
            <div style={{ display: 'flex', width: widthPct + '%', minWidth: 120, height: 30, borderRadius: 7,
                          overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)' }}>
              {stageOrder.map(s => {
                const v = f.stages[s] && f.stages[s].median;
                if (!v) return null;
                const segPct = (v / total) * 100;
                return (
                  <div key={s} title={`${STAGE_META[s].label}: ${fmt(v)}`}
                       style={{ width: segPct + '%', background: STAGE_META[s].color, display: 'flex',
                                alignItems: 'center', justifyContent: 'center', color: '#fff',
                                fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {segPct > 9 ? Math.round(v) : ''}
                  </div>
                );
              })}
            </div>

            {/* phase rollup chips */}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
              <Chip label="Pre-analytical" val={fmt(f.phases.pre_analytical)} tone="#E24B4A" />
              <Chip label="Analytical"     val={fmt(f.phases.analytical)}     tone="#1D9E75" />
              <Chip label="Post-analytical" val={fmt(f.phases.post_analytical)} tone="#7F77DD" />
            </div>
          </div>
        );
      })}
    </>
  );
}

const filterBar = {
  display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'flex-end',
  background: '#fff', border: '1px solid #e8ecf4', borderRadius: 12,
  padding: '0.9rem 1.1rem', marginBottom: '1.2rem', boxShadow: '0 1px 8px rgba(15,18,24,0.04)',
};

const input = {
  height: 34, padding: '0 0.6rem', fontSize: '0.8rem', color: '#0f1218',
  border: '1px solid #dde3ee', borderRadius: 8, background: '#fff', outline: 'none',
};

const btnPrimary = {
  height: 34, padding: '0 1rem', fontSize: '0.8rem', fontWeight: 700, color: '#fff',
  background: '#f97316', border: 'none', borderRadius: 8, cursor: 'pointer',
};

const btnGhost = {
  height: 34, padding: '0 0.9rem', fontSize: '0.8rem', fontWeight: 600, color: '#475569',
  background: '#fff', border: '1px solid #dde3ee', borderRadius: 8, cursor: 'pointer',
};

const card = {
  background: '#fff', border: '1px solid #e8ecf4', borderRadius: 14,
  padding: '1.1rem 1.3rem', marginBottom: '1rem', boxShadow: '0 1px 8px rgba(15,18,24,0.04)',
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <span style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em',
                     textTransform: 'uppercase', color: '#8892a4' }}>{label}</span>
      {children}
    </label>
  );
}

function Chip({ label, val, tone }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem',
                   color: '#475569', background: '#f8fafc', border: '1px solid #e8ecf4',
                   padding: '0.3rem 0.65rem', borderRadius: 100 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone }} />
      {label} <b style={{ color: '#0f1218' }}>{val}</b>
    </span>
  );
}

function Msg({ text, error }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: error ? '#dc2626' : '#8892a4', fontSize: '0.9rem' }}>
      {text}
    </div>
  );
}
