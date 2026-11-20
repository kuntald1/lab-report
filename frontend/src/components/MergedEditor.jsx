import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '../services/auth';

/**
 * Edits everything one patient (barcode) has, laid out like the printed report:
 * one block per test, the analyser transmissions of a test merged, parameters in
 * report order and under report names. Used by the Results side panel and by
 * the "Edit All" popup, so both behave identically.
 *
 * Every row remembers which stored result (and which position in it) it came
 * from, so Save writes each change back to its own result and leaves the rest of
 * that result untouched. Only results that really changed are saved.
 *
 *   ids           result ids of this patient to show
 *   results       the Results page list (to read each result's stored parameters / note)
 *   noteResultId  the result the Note box belongs to
 *   onSaved(list) called with [{ id, updated }] — what the server stored
 *   onCancel()    optional
 */
const errText = (d) => Array.isArray(d) ? d.map(x => x?.msg || String(x)).join('; ') : (d || '');
const keyOf = (p) => String(p.param || p.name || '').trim().toUpperCase();
const cleanRow = (p) => { const { _k, heading, result_id, src_ix, ...rest } = p; return rest; };

export default function MergedEditor({ ids, results, noteResultId, onSaved, onCancel }) {
  const [panels, setPanels] = useState(null);       // null = loading
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcDirty, setCalcDirty] = useState(false);
  const [addPanel, setAddPanel] = useState(null);   // { pi, list }
  const [msg, setMsg] = useState('');
  const origRef = useRef({});
  const idsKey = ids.join(',');

  const missingFor = async (id, rows) => {
    try {
      const res = await authedFetch(`/results/${id}/missing-parameters`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: rows }) });
      return res.ok ? ((await res.json()).parameters || []) : [];
    } catch { return []; }
  };

  useEffect(() => {
    let live = true, n = 0;
    setPanels(null); setMsg(''); setCalcDirty(false); setAddPanel(null);
    setNote((results.find(r => r.id === noteResultId) || {}).note || '');
    authedFetch(`/results/report-view?ids=${idsKey}`).then(r => r.ok ? r.json() : null).then(d => {
      if (!live) return;
      const ps = ((d && d.panels) || []).map(pn => ({ title:pn.title, accession:pn.accession, primaryId:pn.result_ids[0],
        rows: pn.parameters.map(p => ({ ...p, _k:`k${n++}` })) }));
      origRef.current = Object.fromEntries(ps.flatMap(pn => pn.rows.map(r => [r._k, { ...r }])));
      setPanels(ps);
      ps.forEach((pn, pi) => missingFor(pn.primaryId, pn.rows.map(cleanRow)).then(extra => { if (!live) return;
        setPanels(prev => prev && prev.map((x, xi) => xi !== pi ? x : { ...x, rows:[...x.rows,
          ...extra.filter(e => !x.rows.some(p => keyOf(p) === keyOf(e)))
                  .map(e => ({ ...e, result_id:x.primaryId, _k:`m${pi}_${n++}` }))] })); }));
    }).catch(() => { if (live) setPanels([]); });
    return () => { live = false; };
  }, [idsKey, noteResultId]);   // eslint-disable-line

  const change = (pi, ri, field, val) => {
    if (field === 'value') setCalcDirty(true);
    setPanels(prev => prev.map((x, xi) => xi !== pi ? x : { ...x, rows:x.rows.map((r, i) => i !== ri ? r
      : { ...r, [field]:val, ...(field === 'flag' ? { flag_manual:true } : {}) }) }));
  };
  const remove = (pi, ri) => { setCalcDirty(true); setAddPanel(null);
    setPanels(prev => prev.map((x, xi) => xi !== pi ? x : { ...x, rows:x.rows.filter((_, i) => i !== ri) })); };
  const openAdd = async (pi) => { const pn = panels[pi]; setAddPanel({ pi, list: await missingFor(pn.primaryId, pn.rows.map(cleanRow)) }); };
  const addParam = (idx) => {
    if (!addPanel) return; const row = addPanel.list[idx], pi = addPanel.pi;
    if (row) setPanels(prev => prev.map((x, xi) => xi !== pi ? x : { ...x, rows:[...x.rows, { ...row, result_id:x.primaryId, _k:`a${Date.now()}` }] }));
    setAddPanel(null);
  };

  const calculate = async () => {
    setCalcBusy(true); setMsg('');
    try {
      for (let pi = 0; pi < panels.length; pi++) {
        const pn = panels[pi];
        const res = await authedFetch(`/results/${pn.primaryId}/calculate`, { method:'POST',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: pn.rows.map(cleanRow) }) });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(errText(e.detail) || 'Calculate failed'); }
        const out = (await res.json()).parameters || [];
        setPanels(prev => prev.map((x, xi) => {
          if (xi !== pi) return x;
          const rows = [...x.rows];
          out.forEach((op, oi) => {
            const ix = rows.findIndex(r => keyOf(r) === keyOf(op));
            if (ix >= 0) rows[ix] = { ...rows[ix], value:op.value, flag: op.flag ?? rows[ix].flag };
            else rows.push({ ...op, result_id:x.primaryId, _k:`c${Date.now()}_${oi}` });
          });
          return { ...x, rows };
        }));
      }
      setCalcDirty(false);
    } catch (e) { setMsg(String(e.message || 'Calculate failed')); }
    setCalcBusy(false);
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const orig = origRef.current;
      const cur = new Map(panels.flatMap(pn => pn.rows.map(r => [r._k, r])));
      const byId = new Map();
      const get = (id) => {
        if (!byId.has(id)) { const r = results.find(x => x.id === id);
          byId.set(id, { r, params:((r?.parsed_data?.parameters) || []).map(p => ({ ...p })), del:new Set(), add:[], dirty:false }); }
        return byId.get(id);
      };
      Object.values(orig).forEach(o => {
        if (o.src_ix == null || o.result_id == null) return;
        const c = cur.get(o._k), e = get(o.result_id), p = e.params[o.src_ix];
        if (!p) return;
        if (!c) { e.del.add(o.src_ix); e.dirty = true; return; }
        if (String(c.value ?? '') !== String(o.value ?? '')) { p.value = c.value; e.dirty = true; }
        if ((c.flag || 'N') !== (o.flag || 'N')) { p.flag = c.flag; p.flag_manual = true; e.dirty = true; }
      });
      panels.forEach(pn => pn.rows.forEach(c => {
        const o = orig[c._k];
        if (o && o.src_ix != null) return;
        if (String(c.value ?? '').trim() === '') return;
        if (o && String(c.value) === String(o.value ?? '')) return;
        const e = get(pn.primaryId); e.add.push(cleanRow(c)); e.dirty = true;
      }));
      const noteBefore = (results.find(r => r.id === noteResultId) || {}).note || '';
      if (note !== noteBefore && noteResultId != null) get(noteResultId).dirty = true;
      const saved = [];
      for (const [id, e] of byId) {
        if (!e.dirty) continue;
        const params = [...e.params.filter((_, i) => !e.del.has(i)), ...e.add];
        const res = await authedFetch(`/results/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ parameters: params, note: id === noteResultId ? note : (e.r?.note || '') }) });
        if (!res.ok) { const er = await res.json().catch(()=>({})); throw new Error(errText(er.detail) || 'Save failed'); }
        saved.push({ id, updated: await res.json() });
      }
      setMsg(saved.length ? '✓ Saved' : 'No changes to save');
      if (saved.length) onSaved && onSaved(saved);
    } catch (e) { setMsg(String(e.message || 'Save failed')); }
    setSaving(false);
  };

  const btnSave = { background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.5rem 1.1rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif', fontSize:'0.8rem' };
  const btnCancel = { background:'#fff', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'9px', padding:'0.5rem 0.9rem', cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.8rem' };
  const ActionBar = ({ sticky }) => (
    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap', justifyContent:'flex-end',
      ...(sticky ? { position:'sticky', top:0, zIndex:2, background:'#fff', padding:'0.5rem 0', borderBottom:'1px solid #f1f3f8' } : { marginTop:'0.4rem' }) }}>
      {msg && <span style={{ marginRight:'auto', fontSize:'0.76rem', fontWeight:700, color: msg.startsWith('✓') ? '#16a34a' : (msg.startsWith('No changes') ? '#8892a4' : '#dc2626') }}>{msg}</span>}
      {sticky && calcDirty && <span style={{ fontSize:'0.7rem', color:'#c2410c', fontWeight:700 }}>Values changed — click Calculate</span>}
      {sticky && <button onClick={calculate} disabled={calcBusy} title="Recalculate dependent values from the values below"
        style={{ background: calcDirty ? 'linear-gradient(135deg,#f97316,#fbbf24)' : '#fff', color: calcDirty ? '#fff' : '#c2410c', border:'1px solid rgba(249,115,22,0.4)', borderRadius:'8px', padding:'0.45rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>{calcBusy ? '…' : '🧮 Calculate'}</button>}
      <button onClick={save} disabled={saving} style={btnSave}>{saving ? 'Saving…' : '✓ Save Changes'}</button>
      {onCancel && <button onClick={onCancel} disabled={saving} style={btnCancel}>Cancel</button>}
    </div>
  );

  if (panels === null) return <div style={{ fontSize:'0.8rem', color:'#8892a4', padding:'0.8rem 0' }}>Loading…</div>;
  if (panels.length === 0) return <div style={{ fontSize:'0.8rem', color:'#8892a4', padding:'0.8rem 0' }}>Nothing to edit here.{onCancel && <> <button onClick={onCancel} style={btnCancel}>Close</button></>}</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
      <ActionBar sticky />
      {panels.map((pn, pi) => (
        <div key={pn.accession || pi} style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'0.6rem' }}>
          <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:800, fontSize:'0.8rem', color:'#0f1218', textTransform:'uppercase', letterSpacing:'0.03em', borderBottom:'2px solid #0f1218', paddingBottom:'0.25rem' }}>{pn.title}</div>
          {pn.rows.map((p, ri) => (
            <div key={p._k} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.8rem', display:'grid', gridTemplateColumns:'1.3fr 0.8fr 0.6fr 0.7fr auto', gap:'0.4rem', alignItems:'center' }}>
              <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{p.name || p.param}
                {p.added && <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', fontWeight:700, color:'#1d4ed8', background:'rgba(59,130,246,0.1)', borderRadius:4, padding:'0.1rem 0.35rem' }}>enter manually</span>}
                {p.calculated && <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', fontWeight:700, color:'#c2410c', background:'rgba(249,115,22,0.1)', borderRadius:4, padding:'0.1rem 0.35rem' }}>calculated</span>}</div>
              <input value={p.value ?? ''} onChange={e => change(pi, ri, 'value', e.target.value)}
                style={{ padding:'0.4rem 0.5rem', borderRadius:6, border:'1.5px solid #f97316', fontSize:'0.82rem', fontWeight:700, width:'100%', boxSizing:'border-box' }} />
              <select value={p.flag || 'N'} onChange={e => change(pi, ri, 'flag', e.target.value)}
                style={{ padding:'0.4rem 0.3rem', borderRadius:6, border:'1px solid #e8ecf4', fontSize:'0.76rem' }}>
                <option value="N">Normal</option><option value="H">High</option><option value="L">Low</option>
              </select>
              <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>{p.unit}{p.ref_text ? ` · ${String(p.ref_text).split('\n')[0]}…` : ` · ${p.ref_min ?? ''}–${p.ref_max ?? ''}`}</div>
              <button onClick={() => remove(pi, ri)} title="Remove this row from the report" style={{ background:'transparent', border:'none', color:'#dc2626', cursor:'pointer', fontSize:'0.9rem', padding:'0.2rem 0.4rem' }}>✕</button>
            </div>
          ))}
          <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap' }}>
            <button onClick={() => openAdd(pi)} style={{ background:'#fff', color:'#1d4ed8', border:'1px dashed rgba(59,130,246,0.5)', borderRadius:'8px', padding:'0.4rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>+ Add parameter</button>
            {addPanel && addPanel.pi === pi && (addPanel.list.length === 0
              ? <span style={{ fontSize:'0.72rem', color:'#8892a4' }}>Every parameter of this test is already listed.</span>
              : <select defaultValue="" onChange={e => addParam(e.target.value)} style={{ padding:'0.4rem 0.5rem', borderRadius:6, border:'1px solid #e8ecf4', fontSize:'0.78rem' }}>
                  <option value="" disabled>Pick a parameter…</option>
                  {addPanel.list.map((r, k) => <option key={k} value={k}>{r.name}</option>)}
                </select>)}
          </div>
        </div>
      ))}
      <div>
        <label style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' }}>Note (shown at the end of the report if filled in)</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sample slightly hemolysed; recommend repeat in 2 weeks"
          style={{ width:'100%', minHeight:'60px', padding:'0.6rem 0.8rem', borderRadius:9, border:'1.5px solid #e8ecf4', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif', resize:'vertical', boxSizing:'border-box' }} />
      </div>
      <ActionBar />
    </div>
  );
}
