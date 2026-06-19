import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

const STAGE_META = {
  wait_for_pickup:      { label: 'Wait for pickup',  color: '#E24B4A' },
  transit:              { label: 'Transit',          color: '#D85A30' },
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

export default function TAT() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch('/tat/by-franchise')
      .then(r => { if (!r.ok) throw new Error('Failed to load TAT (' + r.status + ')'); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Msg text="Loading turnaround-time report…" />;
  if (err)     return <Msg text={err} error />;
  if (!data || !data.franchises.length) return <Msg text="No turnaround-time data yet. Orders with sample events will appear here." />;

  const stageOrder = data.stage_order;
  const maxTotal = Math.max(...data.franchises.map(f => (f.total && f.total.median) || 0), 1);

  return (
    <div>
      <div style={{ marginBottom: '1.4rem' }}>
        <h1 style={{ fontFamily: 'Manrope,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0f1218', margin: 0 }}>
          Turnaround Time
        </h1>
        <p style={{ fontSize: '0.82rem', color: '#8892a4', margin: '0.3rem 0 0' }}>
          Median per stage, by franchise · {data.window.from.slice(0, 10)} → {data.window.to.slice(0, 10)}
        </p>
      </div>

      {/* shared legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', marginBottom: '1.2rem' }}>
        {stageOrder.map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#8892a4' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: STAGE_META[s].color }} />
            {STAGE_META[s].label}
          </span>
        ))}
      </div>

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
    </div>
  );
}

const card = {
  background: '#fff', border: '1px solid #e8ecf4', borderRadius: 14,
  padding: '1.1rem 1.3rem', marginBottom: '1rem', boxShadow: '0 1px 8px rgba(15,18,24,0.04)',
};

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
