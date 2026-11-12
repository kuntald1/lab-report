import { useEffect, useMemo, useState } from 'react';
import { authedFetch, auth } from '../services/auth';

/**
 * Cost Estimate — a quote, before anything exists.
 *
 * Pick Direct / walk-in or a franchise, tick tests and groups, and the same
 * resolver billing uses prices them: base rates for Direct, the franchise's
 * own group or organization rate otherwise. A discount comes off the total,
 * and the quote goes out on WhatsApp.
 *
 * Nothing here creates a patient, a bill or a sample.
 */

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.65rem 0.9rem',
              color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase',
              letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const card = { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem',
               boxShadow:'0 2px 16px rgba(15,18,24,0.07)' };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { maximumFractionDigits:0 });

export default function CostEstimate() {
  const me = auth.user() || {};
  const isFranchise = (me.role || '').toLowerCase() === 'franchise';

  const [orgs, setOrgs]       = useState([]);
  const [tests, setTests]     = useState([]);
  const [groups, setGroups]   = useState([]);
  // '' = Direct / walk-in. A franchise login is pinned to its own organization.
  const [orgId, setOrgId]     = useState(isFranchise ? String(me.franchise_id || '') : '');
  const [picked, setPicked]   = useState({ tests:[], groups:[] });
  const [priced, setPriced]   = useState({ tests:{}, groups:{} });
  const [search, setSearch]   = useState('');
  const [discount, setDiscount]   = useState('');
  const [discType, setDiscType]   = useState('flat');     // 'flat' (₹) | 'percent'
  const [qty, setQty]             = useState({});         // {'group:5': 2, 'test:12': 3} — missing = 1
  const [pdfBusy, setPdfBusy]     = useState(false);
  const [patientName, setPatientName] = useState('');
  const [toNumber, setToNumber]   = useState('');
  const [sending, setSending]     = useState(false);
  const [toast, setToast]         = useState(null);

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 4000); };

  useEffect(() => {
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(d=>setOrgs(Array.isArray(d)?d:[])).catch(()=>{});
    authedFetch('/b2b/tests').then(r=>r.ok?r.json():[]).then(d=>setTests(Array.isArray(d)?d:[])).catch(()=>{});
    authedFetch('/b2b/test-groups').then(r=>r.ok?r.json():[]).then(d=>setGroups(Array.isArray(d)?d:[])).catch(()=>{});
  }, []);

  // Price the WHOLE catalog for whoever is selected, not just the basket. A
  // franchise rate is not the base rate, and showing the base price next to a
  // test while the quote beside it charges another figure is how a lab quotes
  // the wrong number. One lookup per side, redone when the organization changes.
  useEffect(() => {
    const qs = orgId ? `organization_id=${orgId}&` : '';
    const ids = tests.map(t=>t.id);
    if (ids.length) {
      authedFetch(`/billing/resolve?${qs}test_ids=${ids.join(',')}`)
        .then(r=>r.ok?r.json():[]).then(rows => {
          const m = {}; (rows||[]).forEach(x => { m[x.test_id] = x; });
          setPriced(p => ({ ...p, tests:m }));
        }).catch(()=>{});
    }
    const gids = groups.map(g=>g.id);
    if (gids.length) {
      authedFetch(`/billing/resolve-groups?${qs}group_ids=${gids.join(',')}`)
        .then(r=>r.ok?r.json():[]).then(rows => {
          const m = {}; (rows||[]).forEach(x => { m[x.group_id] = x; });
          setPriced(p => ({ ...p, groups:m }));
        }).catch(()=>{});
    }
  }, [orgId, tests, groups]);

  // what a catalog row costs for the selected organization, falling back to the
  // catalog's own figure until the lookup lands
  const rateOf = (kind, it) => {
    const r = priced[kind][it.id];
    return r ? r.price : it.price;
  };

  const toggle = (kind, id) => {
    // un-ticking forgets the quantity, so ticking it again starts from 1
    const key = `${kind === 'groups' ? 'group' : 'test'}:${id}`;
    if (picked[kind].includes(id)) setQty(q => { const n = { ...q }; delete n[key]; return n; });
    setPicked(p => {
      const list = p[kind];
      return { ...p, [kind]: list.includes(id) ? list.filter(x=>x!==id) : [...list, id] };
    });
  };

  const qtyOf  = (kind, id) => qty[`${kind}:${id}`] || 1;
  const setQ   = (kind, id, n) => setQty(q => ({ ...q, [`${kind}:${id}`]: Math.max(1, Math.min(99, n)) }));

  const rows = useMemo(() => [
    ...picked.groups.map(id => ({ kind:'group', id,
      name: groups.find(g=>g.id===id)?.name || `#${id}`, ...(priced.groups[id] || {}), qty: qtyOf('group', id) })),
    ...picked.tests.map(id => ({ kind:'test', id,
      name: tests.find(t=>t.id===id)?.name || `#${id}`, ...(priced.tests[id] || {}), qty: qtyOf('test', id) })),
  ], [picked, priced, tests, groups, qty]);   // eslint-disable-line

  const mrpTotal   = rows.reduce((s,r)=>s + (Number(r.mrp)||0) * r.qty, 0);
  const priceTotal = rows.reduce((s,r)=>s + (Number(r.price)||0) * r.qty, 0);
  // Mirrors the server: never negative, never more than the total; % held to 0–100.
  const discRaw = Number(discount)||0;
  const disc    = discType === 'percent'
    ? Math.min(priceTotal, Math.round(priceTotal * Math.max(0, Math.min(discRaw, 100))) / 100)
    : Math.max(0, Math.min(discRaw, priceTotal));
  const payable = priceTotal - disc;

  // what the server needs to price exactly what is on screen
  const payload = () => ({
    organization_id: orgId ? parseInt(orgId) : null,
    test_ids: picked.tests, group_ids: picked.groups,
    test_qty:  Object.fromEntries(picked.tests.map(id => [String(id), qtyOf('test', id)])),
    group_qty: Object.fromEntries(picked.groups.map(id => [String(id), qtyOf('group', id)])),
    discount_type: discType, discount_value: Number(discount)||0,
    patient_name: patientName || null,
  });

  const downloadPdf = async () => {
    if (!rows.length) return showToast('error', 'Pick at least one test or group');
    setPdfBusy(true);
    try {
      const res = await authedFetch('/estimates/pdf', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload()) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'PDF failed'); }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `Estimate_${(patientName||'quote').replace(/[^A-Za-z0-9_-]/g,'')}.pdf`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 30000);
    } catch (e) { showToast('error', String(e.message || 'Could not make the PDF')); }
    setPdfBusy(false);
  };

  const org      = orgs.find(o=>String(o.id)===String(orgId));
  const orgPhone = org?.phone || '';

  const send = async () => {
    if (!rows.length) return showToast('error', 'Pick at least one test or group');
    const to = (toNumber || '').trim() || orgPhone;
    if (!to) return showToast('error', orgId
      ? 'This organization has no phone on file — type a number'
      : 'Type the WhatsApp number to send to');
    setSending(true);
    try {
      const res = await authedFetch('/estimates/send', { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...payload(), to_number: (toNumber || '').trim() || null }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'send failed'); }
      showToast('success', `Estimate sent to ${to}`);
    } catch (e) { showToast('error', String(e.message || 'Could not send')); }
    setSending(false);
  };

  const shown = (list) => {
    const q = search.trim().toLowerCase();
    return q ? list.filter(x => (x.name||'').toLowerCase().includes(q)) : list;
  };

  return (
    <>
      {toast && (
        <div style={{ position:'fixed', top:'1.3rem', right:'1.3rem', zIndex:9999,
                      background: toast.kind==='error' ? '#dc2626' : '#0f1218', color:'#fff',
                      padding:'0.75rem 1.2rem', borderRadius:'10px', fontSize:'0.84rem', fontWeight:600,
                      boxShadow:'0 10px 30px rgba(15,18,24,0.3)', maxWidth:'380px' }}>
          {toast.kind==='error' ? '⚠ ' : '✓ '}{toast.msg}
        </div>
      )}

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)',
                      color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700,
                      textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Billing</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Cost Estimate</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>
          Quote a price before anything is booked — no patient, no bill, no sample is created.
        </p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.3fr) minmax(320px,0.9fr)', gap:'1.2rem', alignItems:'start' }}>

        {/* ── left: who it's for, and what's in the basket ── */}
        <div>
          <div style={{ ...card, marginBottom:'1rem' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.9rem' }}>
              <div>
                <label style={lbl}>Estimate for</label>
                <select style={{ ...inp, ...(isFranchise ? { background:'#f1f3f7', color:'#8892a4' } : {}) }}
                        disabled={isFranchise} value={orgId}
                        onChange={e=>setOrgId(e.target.value)}>
                  <option value="">Direct / Walk-in</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.3rem' }}>
                  {orgId ? 'Franchise rates — group or organization pricing.' : 'Base catalog rates.'}
                </div>
              </div>
              <div>
                <label style={lbl}>Patient name <span style={{ textTransform:'none', fontWeight:400 }}>(optional)</span></label>
                <input style={inp} value={patientName} onChange={e=>setPatientName(e.target.value)}
                       placeholder="printed on the estimate" />
              </div>
            </div>
          </div>

          <div style={{ ...card, padding:'1rem 1.2rem', marginBottom:'1rem' }}>
            <input style={{ ...inp, maxWidth:'360px' }} placeholder="Search tests or groups…"
                   value={search} onChange={e=>setSearch(e.target.value)} />
          </div>

          <Picker title="Test Groups" items={shown(groups)} picked={picked.groups}
                  rate={it=>rateOf('groups', it)}
                  onToggle={id=>toggle('groups', id)} empty="No groups yet." />
          <Picker title="Tests" items={shown(tests)} picked={picked.tests}
                  rate={it=>rateOf('tests', it)}
                  onToggle={id=>toggle('tests', id)} empty="No tests yet." />
        </div>

        {/* ── right: the quote itself ── */}
        <div style={{ ...card, position:'sticky', top:'1rem' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'1rem', color:'#0f1218', marginBottom:'0.2rem' }}>
            {org ? org.name : 'Direct / Walk-in'}
          </div>
          <div style={{ color:'#8892a4', fontSize:'0.76rem', marginBottom:'1rem' }}>
            {rows.length} item{rows.length===1?'':'s'} selected
          </div>

          {rows.length === 0 ? (
            <div style={{ color:'#8892a4', fontSize:'0.85rem', padding:'1.5rem 0', textAlign:'center' }}>
              Tick a test or a group to start.
            </div>
          ) : (
            <div style={{ borderTop:'1px solid #f1f4f9', marginBottom:'0.9rem' }}>
              {rows.map(r => (
                <div key={r.kind+r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                                                gap:'0.6rem', padding:'0.5rem 0', borderBottom:'1px solid #f7f8fb' }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:'0.83rem', color:'#0f1218', fontWeight:600 }}>{r.name}</div>
                    {r.kind === 'group' && (
                      <span style={{ fontSize:'0.6rem', background:'rgba(249,115,22,0.12)', color:'#c2410c',
                                     padding:'0.1rem 0.45rem', borderRadius:'20px', fontWeight:700 }}>GROUP</span>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.7rem', whiteSpace:'nowrap' }}>
                    <QtyStepper value={r.qty} onChange={n=>setQ(r.kind, r.id, n)} />
                    <div style={{ textAlign:'right', minWidth:'86px' }}>
                      <div style={{ fontWeight:700, color:'#16a34a', fontSize:'0.86rem' }}>{inr((Number(r.price)||0) * r.qty)}</div>
                      <div style={{ color:'#8892a4', fontSize:'0.7rem' }}>
                        {Number(r.mrp) > Number(r.price) && <span style={{ textDecoration:'line-through', marginRight:'0.3rem', color:'#c4cad6' }}>{inr(r.mrp)}</span>}
                        {r.qty > 1 ? `${inr(r.price)} × ${r.qty}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Row label="MRP total"   value={inr(mrpTotal)} muted strike={mrpTotal > priceTotal} />
          <Row label="Price total" value={inr(priceTotal)} />

          <div style={{ margin:'0.8rem 0' }}>
            <label style={lbl}>Discount</label>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <div style={{ display:'flex', border:'1.5px solid #e8ecf4', borderRadius:'9px', overflow:'hidden', flexShrink:0 }}>
                {[['flat','₹'],['percent','%']].map(([k,l]) => (
                  <button key={k} type="button" onClick={()=>setDiscType(k)}
                    style={{ border:'none', padding:'0 0.95rem', fontWeight:800, cursor:'pointer', fontSize:'0.9rem',
                             background: discType===k ? '#f97316' : '#fafbfc', color: discType===k ? '#fff' : '#8892a4' }}>{l}</button>
                ))}
              </div>
              <input style={inp} type="number" min="0" max={discType==='percent' ? 100 : undefined} value={discount} placeholder="0"
                     onChange={e=>setDiscount(e.target.value)} />
            </div>
            {discType === 'percent' && disc > 0 && (
              <div style={{ fontSize:'0.72rem', color:'#475569', marginTop:'0.25rem' }}>{Math.min(discRaw,100)}% of {inr(priceTotal)} = {inr(disc)} off</div>
            )}
            {((discType === 'flat' && discRaw > priceTotal) || (discType === 'percent' && discRaw > 100)) && priceTotal > 0 && (
              <div style={{ fontSize:'0.72rem', color:'#c2410c', marginTop:'0.25rem' }}>
                Capped at the total — payable cannot go below zero.
              </div>
            )}
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                        borderTop:'2px solid #0f1218', paddingTop:'0.7rem', marginBottom:'1.1rem' }}>
            <span style={{ fontWeight:800, color:'#0f1218', fontSize:'0.92rem' }}>Payable</span>
            <span style={{ fontWeight:800, color:'#f97316', fontSize:'1.3rem' }}>{inr(payable)}</span>
          </div>

          <button onClick={downloadPdf} disabled={pdfBusy || !rows.length}
            style={{ width:'100%', marginBottom:'1rem', background:'#fff', color: rows.length ? '#0e7d6b' : '#c4cad6',
                     border:`1.5px solid ${rows.length ? '#0e7d6b' : '#e8ecf4'}`, borderRadius:'10px', padding:'0.7rem 1rem',
                     fontWeight:700, cursor: rows.length && !pdfBusy ? 'pointer' : 'default', fontFamily:'Manrope,sans-serif', fontSize:'0.88rem' }}>
            {pdfBusy ? 'Preparing PDF…' : '⬇  Download PDF'}
          </button>

          <div style={{ borderTop:'1px solid #f1f4f9', paddingTop:'1rem' }}>
            <label style={lbl}>Send on WhatsApp</label>
            {orgId && orgPhone ? (
              <>
                <div style={{ fontSize:'0.8rem', color:'#475569', marginBottom:'0.5rem' }}>
                  Goes to <b>{org?.name}</b> on <span style={{ fontFamily:'monospace' }}>{orgPhone}</span> unless you type another number.
                </div>
                <input style={inp} value={toNumber} onChange={e=>setToNumber(e.target.value)}
                       placeholder={`or another number (default ${orgPhone})`} />
              </>
            ) : (
              <>
                {orgId && (
                  <div style={{ fontSize:'0.76rem', color:'#c2410c', marginBottom:'0.4rem' }}>
                    This organization has no phone on file — type a number.
                  </div>
                )}
                <input style={inp} value={toNumber} onChange={e=>setToNumber(e.target.value)}
                       placeholder="10-digit mobile" />
              </>
            )}
            <button onClick={send} disabled={sending || !rows.length}
              style={{ marginTop:'0.7rem', width:'100%', background: rows.length ? '#16a34a' : '#c4cad6',
                       color:'#fff', border:'none', borderRadius:'10px', padding:'0.75rem 1rem',
                       fontWeight:700, cursor: rows.length && !sending ? 'pointer' : 'default',
                       fontFamily:'Manrope,sans-serif', fontSize:'0.9rem' }}>
              {sending ? 'Sending…' : '💬  Send Estimate'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function QtyStepper({ value, onChange }) {
  const b = { width:'26px', height:'26px', border:'none', background:'#f1f4f9', color:'#0f1218', fontWeight:800, cursor:'pointer', fontSize:'0.95rem', lineHeight:1 };
  return (
    <div title="Quantity" style={{ display:'inline-flex', alignItems:'center', border:'1px solid #e8ecf4', borderRadius:'8px', overflow:'hidden' }}>
      <button type="button" style={b} onClick={()=>onChange(value-1)} disabled={value<=1}>−</button>
      <input value={value} onChange={e=>{ const n = parseInt(e.target.value,10); if (!isNaN(n)) onChange(n); }}
        style={{ width:'32px', height:'26px', border:'none', textAlign:'center', fontWeight:700, fontSize:'0.82rem', outline:'none', fontFamily:'Manrope,sans-serif' }} />
      <button type="button" style={b} onClick={()=>onChange(value+1)}>+</button>
    </div>
  );
}

function Row({ label, value, muted, strike }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.84rem', padding:'0.25rem 0',
                  color: muted ? '#8892a4' : '#0f1218' }}>
      <span>{label}</span>
      <span style={{ fontWeight:700, textDecoration: strike ? 'line-through' : 'none' }}>{value}</span>
    </div>
  );
}

function Picker({ title, items, picked, onToggle, empty, rate }) {
  return (
    <div style={{ ...card, padding:0, overflow:'hidden', marginBottom:'1rem' }}>
      <div style={{ padding:'0.85rem 1.2rem', borderBottom:'1.5px solid #e8ecf4', background:'#fafbfc',
                    fontWeight:800, fontSize:'0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
        {title} <span style={{ color:'#8892a4', fontWeight:600, fontSize:'0.76rem' }}>· {items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ padding:'1.2rem', color:'#8892a4', fontSize:'0.84rem' }}>{empty}</div>
      ) : (
        <div style={{ maxHeight:'320px', overflowY:'auto' }}>
          {items.map(it => {
            const on = picked.includes(it.id);
            return (
              <label key={it.id}
                style={{ display:'flex', alignItems:'center', gap:'0.7rem', padding:'0.6rem 1.2rem',
                         borderBottom:'1px solid #f7f8fb', cursor:'pointer',
                         background: on ? 'rgba(249,115,22,0.05)' : 'transparent' }}>
                <input type="checkbox" checked={on} onChange={()=>onToggle(it.id)}
                       style={{ accentColor:'#f97316', width:'15px', height:'15px', cursor:'pointer' }} />
                <span style={{ flex:1, fontSize:'0.85rem', color:'#0f1218', fontWeight: on ? 700 : 500 }}>{it.name}</span>
                <span style={{ fontSize:'0.78rem', color:'#8892a4' }}>{inr(rate ? rate(it) : it.price)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
