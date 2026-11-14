import { useEffect, useState } from 'react';
import { authedFetch } from '../services/auth';

/**
 * The parameter-value editor, on its own so a screen can show several at once:
 * the Results page's "Edit All" popup puts one of these inside every barcode it
 * loaded, and the Blank Report page uses one to fill in a report that no
 * analyser ever sent. Each instance talks to its own result and keeps its own
 * Save button, so saving one report never touches another.
 *
 * `result` needs id, parsed_data and note. `onSaved(updated)` is called with
 * what the server stored, so the parent can refresh its copy.
 */
const errText = (d) => Array.isArray(d) ? d.map(x => x?.msg || String(x)).join('; ') : (d || '');

export default function ResultEditor({ result, onSaved, onCancel, compact }) {
  const [params, setParams] = useState([]);
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcDirty, setCalcDirty] = useState(false);
  const [addList, setAddList]   = useState(null);
  const [msg, setMsg]           = useState('');

  const loadMissing = async (rows) => {
    try {
      const res = await authedFetch(`/results/${result.id}/missing-parameters`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: rows }) });
      return res.ok ? ((await res.json()).parameters || []) : [];
    } catch { return []; }
  };

  useEffect(() => {
    const base = (result.parsed_data?.parameters || []).map(p => ({ ...p }));
    setParams(base); setNote(result.note || ''); setCalcDirty(false); setAddList(null); setMsg('');
    loadMissing(base).then(extra =>
      setParams(prev => [...prev, ...extra.filter(e => !prev.some(p => p.name === e.name))]));
  }, [result.id]);   // eslint-disable-line

  const change = (i, field, val) => {
    if (field === 'value') setCalcDirty(true);
    setParams(prev => prev.map((p, idx) => idx === i
      ? { ...p, [field]: val, ...(field === 'flag' ? { flag_manual: true } : {}) } : p));
  };
  const remove = (i) => { setParams(prev => prev.filter((_, idx) => idx !== i)); setCalcDirty(true); setAddList(null); };
  const openAdd = async () => setAddList(await loadMissing(params));
  const addParam = (idx) => { const row = addList?.[idx]; if (row) setParams(prev => [...prev, row]); setAddList(null); };

  const calculate = async () => {
    setCalcBusy(true);
    try {
      const res = await authedFetch(`/results/${result.id}/calculate`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: params }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(errText(e.detail) || 'Calculate failed'); }
      setParams((await res.json()).parameters); setCalcDirty(false);
    } catch (e) { setMsg(String(e.message || 'Calculate failed')); }
    setCalcBusy(false);
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await authedFetch(`/results/${result.id}`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ parameters: params, note }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(errText(e.detail) || 'Save failed'); }
      const updated = await res.json();
      setMsg('✓ Saved');
      onSaved && onSaved(updated);
    } catch (e) { setMsg(String(e.message || 'Save failed')); }
    setSaving(false);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', justifyContent:'flex-end' }}>
        {calcDirty && <span style={{ fontSize:'0.7rem', color:'#c2410c', fontWeight:700 }}>Values changed — click Calculate to refresh calculated rows</span>}
        <button onClick={calculate} disabled={calcBusy} title="Recalculate the rows worked out from other values"
          style={{ background: calcDirty ? 'linear-gradient(135deg,#f97316,#fbbf24)' : '#fff', color: calcDirty ? '#fff' : '#c2410c', border:'1px solid rgba(249,115,22,0.4)', borderRadius:'8px', padding:'0.4rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>{calcBusy ? 'Calculating…' : '🧮 Calculate'}</button>
      </div>

      {params.length === 0 && <div style={{ fontSize:'0.78rem', color:'#8892a4' }}>This report has no parameters yet.</div>}

      {params.map((p, i) => (
        <div key={i} style={{ background:'#fafbfc', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.8rem', display:'grid', gridTemplateColumns: compact ? '1.3fr 0.9fr 0.7fr auto' : '1.3fr 0.8fr 0.6fr 0.7fr auto', gap:'0.4rem', alignItems:'center' }}>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>
            {p.name}
            {p.added && <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', fontWeight:700, color:'#1d4ed8', background:'rgba(59,130,246,0.1)', borderRadius:4, padding:'1px 5px' }}>enter manually</span>}
            {p.calculated && <span style={{ marginLeft:'0.4rem', fontSize:'0.6rem', fontWeight:700, color:'#c2410c', background:'rgba(249,115,22,0.1)', borderRadius:4, padding:'1px 5px' }}>calculated</span>}
          </div>
          <input value={p.value ?? ''} onChange={e => change(i, 'value', e.target.value)}
            style={{ padding:'0.4rem 0.5rem', borderRadius:6, border:'1.5px solid #f97316', fontSize:'0.82rem', fontWeight:700, width:'100%', boxSizing:'border-box' }} />
          {!compact && (
            <select value={p.flag || 'N'} onChange={e => change(i, 'flag', e.target.value)}
              style={{ padding:'0.4rem 0.3rem', borderRadius:6, border:'1px solid #e8ecf4', fontSize:'0.76rem' }}>
              <option value="N">Normal</option>
              <option value="H">High</option>
              <option value="L">Low</option>
            </select>
          )}
          <div style={{ fontSize:'0.68rem', color:'#8892a4' }}>{p.unit} · {p.ref_min}–{p.ref_max}</div>
          <button onClick={() => remove(i)} title="Remove this row from the report"
            style={{ background:'transparent', border:'none', color:'#dc2626', cursor:'pointer', fontSize:'0.9rem', padding:'0.2rem 0.4rem' }}>✕</button>
        </div>
      ))}

      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap' }}>
        <button onClick={openAdd} style={{ background:'#fff', color:'#1d4ed8', border:'1px dashed rgba(59,130,246,0.5)', borderRadius:'8px', padding:'0.4rem 0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.76rem', fontFamily:'Manrope,sans-serif' }}>+ Add parameter</button>
        {addList && (addList.length === 0
          ? <span style={{ fontSize:'0.72rem', color:'#8892a4' }}>Every parameter of this test is already listed.</span>
          : <select defaultValue="" onChange={e => addParam(e.target.value)} style={{ padding:'0.4rem 0.5rem', borderRadius:6, border:'1px solid #e8ecf4', fontSize:'0.78rem' }}>
              <option value="" disabled>Pick a parameter…</option>
              {addList.map((r, k) => <option key={k} value={k}>{r.name}</option>)}
            </select>)}
      </div>

      <div>
        <label style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:'0.3rem' }}>Note (shown at the end of the report if filled in)</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sample slightly hemolysed; recommend repeat in 2 weeks"
          style={{ width:'100%', minHeight:'60px', padding:'0.6rem 0.8rem', borderRadius:9, border:'1.5px solid #e8ecf4', fontSize:'0.82rem', fontFamily:'Manrope,sans-serif', resize:'vertical', boxSizing:'border-box' }} />
      </div>

      <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.2rem' }}>
        <button onClick={save} disabled={saving}
          style={{ background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.2rem', cursor:'pointer', fontWeight:700, fontFamily:'Manrope,sans-serif' }}>{saving ? 'Saving…' : '✓ Save'}</button>
        {onCancel && <button onClick={onCancel} disabled={saving} style={{ background:'transparent', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'9px', padding:'0.6rem 1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Cancel</button>}
        {msg && <span style={{ fontSize:'0.76rem', fontWeight:700, color: msg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>{msg}</span>}
      </div>
    </div>
  );
}
