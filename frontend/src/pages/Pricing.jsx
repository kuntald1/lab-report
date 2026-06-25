import { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.8rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const small = { ...inp, padding:'0.4rem 0.6rem', textAlign:'right', width:'90px' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN');

export default function Pricing() {
  const [mode, setMode]       = useState('group');     // 'group' | 'org'
  const [groups, setGroups]   = useState([]);
  const [orgs, setOrgs]       = useState([]);
  const [tests, setTests]     = useState([]);
  const [contextId, setContextId] = useState('');
  const [sel, setSel]         = useState({});          // { test_id: {checked, mrp, price} }
  const [search, setSearch]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [toast, setToast]     = useState(null);   // { kind:'success'|'error'|'info', msg }

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3200); };

  // load lists once
  useEffect(() => {
    authedFetch('/b2b/org-groups').then(r=>r.ok?r.json():[]).then(setGroups).catch(()=>{});
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
    authedFetch('/b2b/tests').then(r=>r.ok?r.json():[]).then(setTests).catch(()=>{});
  }, []);

  const baseOf = (id) => tests.find(t => t.id === id) || {};

  // standalone mode: only organizations NOT in any group
  const standaloneOrgs = orgs.filter(o => !o.org_group_id);
  // members of the currently-selected group (group mode)
  const groupMembers = (mode === 'group' && contextId)
    ? orgs.filter(o => String(o.org_group_id) === String(contextId))
    : [];

  // when context changes, load its existing priced tests
  useEffect(() => {
    setLoaded(false); setSel({});
    if (!contextId) return;
    const url = mode === 'group'
      ? `/b2b/org-groups/${contextId}/tests`
      : `/b2b/organizations/${contextId}/tests`;
    authedFetch(url).then(r=>r.ok?r.json():[]).then(rows => {
      const map = {};
      rows.forEach(r => { map[r.test_id] = { checked:true, mrp:r.mrp ?? 0, price:r.price ?? 0 }; });
      setSel(map); setLoaded(true);
    }).catch(()=>setLoaded(true));
  }, [mode, contextId]);   // eslint-disable-line

  const toggle = (t) => setSel(prev => {
    const cur = prev[t.id];
    if (cur?.checked) return { ...prev, [t.id]: { ...cur, checked:false } };
    // first tick → seed with the base test's own mrp/price as a starting point
    return { ...prev, [t.id]: { checked:true,
      mrp: cur?.mrp ?? (t.mrp ?? 0), price: cur?.price ?? (t.price ?? 0) } };
  });

  const setField = (id, field, value) =>
    setSel(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const checkedIds = Object.keys(sel).filter(id => sel[id]?.checked).map(Number);
  const totals = useMemo(() => {
    let mrp = 0, price = 0;
    checkedIds.forEach(id => { mrp += Number(sel[id].mrp)||0; price += Number(sel[id].price)||0; });
    return { count: checkedIds.length, mrp, price };
  }, [sel]);   // eslint-disable-line

  const filtered = tests.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    if (!contextId) return showToast('info', 'Pick a group or organization first');
    setSaving(true);
    const items = checkedIds.map(id => ({
      test_id: id, mrp: Number(sel[id].mrp)||0, price: Number(sel[id].price)||0 }));
    const url = mode === 'group'
      ? `/b2b/org-groups/${contextId}/tests`
      : `/b2b/organizations/${contextId}/tests`;
    try {
      const res = await authedFetch(url, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) });
      if (!res.ok) throw new Error();
      const label = (mode==='group' ? groups : orgs).find(c=>String(c.id)===String(contextId))?.name || '';
      showToast('success', `Saved ${items.length} test${items.length===1?'':'s'} for ${label}`);
    } catch { showToast('error', 'Save failed — please try again'); }
    setSaving(false);
  };

  const contextList = mode === 'group' ? groups : standaloneOrgs;

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999,
                      display:'flex', alignItems:'center', gap:'0.75rem',
                      background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem',
                      minWidth:'280px', maxWidth:'380px',
                      boxShadow:'0 12px 40px rgba(15,18,24,0.18)',
                      border:'1px solid #eef1f6',
                      borderLeft:`4px solid ${toast.kind==='success' ? '#16a34a' : toast.kind==='error' ? '#dc2626' : '#f97316'}`,
                      animation:'toastIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0,
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem',
                        background: toast.kind==='success' ? 'rgba(22,163,74,0.12)' : toast.kind==='error' ? 'rgba(220,38,38,0.12)' : 'rgba(249,115,22,0.12)' }}>
            {toast.kind==='success' ? '✓' : toast.kind==='error' ? '✕' : 'ℹ'}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>
              {toast.kind==='success' ? 'Saved' : toast.kind==='error' ? 'Something went wrong' : 'Heads up'}
            </div>
            <div style={{ fontSize:'0.76rem', color:'#8892a4', marginTop:'0.1rem' }}>{toast.msg}</div>
          </div>
          <div onClick={()=>setToast(null)} style={{ cursor:'pointer', color:'#c4cad6', fontSize:'1.1rem', lineHeight:1, padding:'0 0.2rem' }}>×</div>
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Master</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>Group / Org Pricing</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>Tick the tests a group or organization carries, and set each one's own MRP &amp; price. These are independent copies — editing here never changes the base test or any other group.</p>
      </div>

      {/* context picker */}
      <div style={{ ...S.card, marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', gap:'1rem', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <label style={lbl}>Apply to</label>
            <div style={{ display:'flex', gap:'0.4rem' }}>
              {['group','org'].map(m => (
                <button key={m} onClick={()=>{ setMode(m); setContextId(''); setSel({}); }}
                  style={{ padding:'0.55rem 1rem', borderRadius:'9px', fontWeight:700, fontSize:'0.8rem', cursor:'pointer', fontFamily:'Manrope,sans-serif',
                    border: mode===m ? '1.5px solid #f97316' : '1.5px solid #e8ecf4',
                    background: mode===m ? 'rgba(249,115,22,0.1)' : '#fff',
                    color: mode===m ? '#f97316' : '#8892a4' }}>
                  {m==='group' ? 'Organization Group' : 'Organization (standalone)'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ minWidth:'260px', flex:1 }}>
            <label style={lbl}>{mode==='group' ? 'Group' : 'Organization'}</label>
            <select style={inp} value={contextId} onChange={e=>setContextId(e.target.value)}>
              <option value="">— Select {mode==='group'?'a group':'an organization'} —</option>
              {contextList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth:'220px', flex:1 }}>
            <label style={lbl}>Search tests</label>
            <input style={inp} placeholder="Filter by name…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
        </div>

        {/* group members: who this pricing applies to */}
        {mode==='group' && contextId && (
          <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid #f4f6fa' }}>
            <div style={{ ...lbl, marginBottom:'0.5rem' }}>Organizations in this group</div>
            {groupMembers.length === 0
              ? <span style={{ color:'#8892a4', fontSize:'0.8rem' }}>No organizations assigned to this group yet.</span>
              : <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                  {groupMembers.map(o => (
                    <span key={o.id} style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1', padding:'0.25rem 0.8rem', borderRadius:'20px', fontSize:'0.78rem', fontWeight:600 }}>{o.name}</span>
                  ))}
                </div>}
          </div>
        )}
        {mode==='org' && standaloneOrgs.length === 0 && (
          <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid #f4f6fa', color:'#8892a4', fontSize:'0.8rem' }}>
            No standalone organizations — every organization currently belongs to a group. Standalone pricing is only for organizations with no group.
          </div>
        )}
      </div>

      {!contextId && (
        <div style={{ ...S.card, textAlign:'center', color:'#8892a4', padding:'3rem' }}>
          Pick a {mode==='group'?'group':'an organization'} above to set its test prices.
        </div>
      )}

      {contextId && (
        <>
          <div style={{ ...S.card, padding:0, overflow:'hidden', marginBottom:'1rem' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#fafbfc', borderBottom:'1.5px solid #e8ecf4' }}>
                  {['', 'Test', 'MRP', 'Price'].map((h,i) => (
                    <th key={i} style={{ textAlign: i>=2?'right':'left', padding:'0.7rem 1.2rem', fontSize:'0.65rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign:'center', padding:'2rem', color:'#8892a4' }}>No tests match.</td></tr>
                )}
                {filtered.map(t => {
                  const row = sel[t.id]; const checked = !!row?.checked;
                  return (
                    <tr key={t.id} style={{ borderBottom:'1px solid #f4f6fa', background: checked ? 'rgba(249,115,22,0.03)' : 'transparent' }}>
                      <td style={{ padding:'0.6rem 1.2rem', width:'40px' }}>
                        <input type="checkbox" checked={checked} onChange={()=>toggle(t)}
                               style={{ width:'17px', height:'17px', accentColor:'#f97316', cursor:'pointer' }} />
                      </td>
                      <td style={{ padding:'0.6rem 1.2rem', fontWeight:600, color:'#0f1218', fontSize:'0.85rem' }}>{t.name}</td>
                      <td style={{ padding:'0.6rem 1.2rem', textAlign:'right' }}>
                        <input style={small} type="number" disabled={!checked}
                          value={checked ? (row.mrp ?? '') : ''} placeholder="—"
                          onChange={e=>setField(t.id,'mrp',e.target.value)} />
                      </td>
                      <td style={{ padding:'0.6rem 1.2rem', textAlign:'right' }}>
                        <input style={small} type="number" disabled={!checked}
                          value={checked ? (row.price ?? '') : ''} placeholder="—"
                          onChange={e=>setField(t.id,'price',e.target.value)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* sticky totals + save */}
          <div style={{ ...S.card, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', bottom:'1rem' }}>
            <div style={{ display:'flex', gap:'2rem' }}>
              <div><div style={lbl}>Selected</div><div style={{ fontSize:'1.3rem', fontWeight:800, color:'#0f1218' }}>{totals.count}</div></div>
              <div><div style={lbl}>Total MRP</div><div style={{ fontSize:'1.3rem', fontWeight:800, color:'#8892a4' }}>{inr(totals.mrp)}</div></div>
              <div><div style={lbl}>Total Price</div><div style={{ fontSize:'1.3rem', fontWeight:800, color:'#16a34a' }}>{inr(totals.price)}</div></div>
            </div>
            <button onClick={save} disabled={saving || !loaded} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.75rem 1.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.9rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)' }}>
              {saving ? 'Saving…' : 'Save Pricing'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
