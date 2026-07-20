import { useEffect, useMemo, useState } from 'react';
import { authedFetch, auth } from '../services/auth';

const inp = { background:'#fafbfc', border:'1.5px solid #e8ecf4', borderRadius:'9px', padding:'0.6rem 0.85rem', color:'#0f1218', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem', outline:'none', width:'100%' };
const lbl = { fontSize:'0.7rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:'0.35rem' };
const S   = { card: { background:'#fff', border:'1px solid #e8ecf4', borderRadius:'14px', padding:'1.5rem', boxShadow:'0 2px 16px rgba(15,18,24,0.07)' } };
const inr = (n) => '₹' + (Number(n)||0).toLocaleString('en-IN', { maximumFractionDigits:2 });
const suffixFor = (idx) => { let n = idx + 1, s = ''; while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65+rem) + s; n = Math.floor((n - 1) / 26); } return s; };

// Note: this badge describes how the TEST's PRICE was resolved (group-rate / org-rate / base-rate)
// — it is unrelated to test *groups* (panels), which get their own orange "GROUP" tag elsewhere.
// Labels are deliberately worded "… rate" so they're never mistaken for a panel/category tag.
const sourceBadge = (src) => {
  const map = { group:['#6366f1','Group rate'], org:['#f97316','Org rate'], base:['#64748b','Base rate'] };
  const [c,label] = map[src] || ['#64748b', src||'—'];
  return <span style={{ background:c+'18', color:c, padding:'0.1rem 0.5rem', borderRadius:'20px', fontSize:'0.65rem', fontWeight:700 }}>{label}</span>;
};

export default function Billing({ isAdmin = true, initialPatientId = '', onManageCredit = () => {} }) {
  const isFranchise = (auth.user()?.role || '').toLowerCase() === 'franchise';
  const allowDiscount = isAdmin && !isFranchise;   // franchise logins never discount
  const [patients, setPatients] = useState([]);
  const [branches, setBranches] = useState([]);
  const [pf, setPf] = useState({ organization_id:'', branch_id:'', date_from:'', date_to:'', patient_id:'', barcode:'', accession:'' });
  const [accPatientIds, setAccPatientIds] = useState(null);   // null = accession filter inactive
  const [accessions, setAccessions] = useState({});           // {test_id: accession_number} preview, editable pre-save
  const [tests, setTests]       = useState([]);
  const [groups, setGroups]     = useState([]);     // test groups / panels
  const [pickedGroups, setPickedGroups] = useState({});  // {gid: {id,name,price,test_ids,tests}}
  const [orgs, setOrgs]         = useState([]);
  const [patientId, setPatientId] = useState(initialPatientId || '');
  const [picked, setPicked]     = useState({});     // {test_id: {name, mrp, price, source}}
  const [search, setSearch]     = useState('');
  const [discType, setDiscType] = useState('');     // '' | 'flat' | 'percent'
  const [discVal, setDiscVal]   = useState('');
  const [onCredit, setOnCredit] = useState(isFranchise);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);
  const [lastBill, setLastBill] = useState(null);
  const [payingMethod, setPayingMethod] = useState(null);   // 'cash'|'upi'|'razorpay'|null
  const [waPhone, setWaPhone]   = useState('');
  const [waBusy, setWaBusy]     = useState(false);
  const [waiting, setWaiting]   = useState(false);   // waiting for customer payment
  const pollRef = useState({ current: null })[0];

  const showToast = (kind, msg) => { setToast({ kind, msg }); setTimeout(()=>setToast(null), 3500); };

  useEffect(() => {
    authedFetch('/patients/').then(r=>r.ok?r.json():[]).then(setPatients).catch(()=>{});
    authedFetch('/b2b/tests').then(r=>r.ok?r.json():[]).then(setTests).catch(()=>{});
    authedFetch('/b2b/test-groups').then(r=>r.ok?r.json():[]).then(setGroups).catch(()=>{});
    authedFetch('/b2b/organizations').then(r=>r.ok?r.json():[]).then(setOrgs).catch(()=>{});
    authedFetch('/admin/branches').then(r=>r.ok?r.json():[]).then(setBranches).catch(()=>{});
  }, []);

  // accession-number search (debounced) -> restricts the patient filter to matching patients
  useEffect(() => {
    const q = pf.accession.trim();
    if (!q) { setAccPatientIds(null); return; }
    const t = setTimeout(() => {
      authedFetch(`/billing/find-by-accession?q=${encodeURIComponent(q)}`)
        .then(r=>r.ok?r.json():{patient_ids:[]})
        .then(d=>setAccPatientIds(d.patient_ids||[]))
        .catch(()=>setAccPatientIds([]));
    }, 350);
    return () => clearTimeout(t);
  }, [pf.accession]);   // eslint-disable-line

  const filteredPatients = useMemo(() => patients.filter(p => {
    if (pf.organization_id && String(p.organization_id) !== pf.organization_id) return false;
    if (pf.branch_id && String(p.branch_id) !== pf.branch_id) return false;
    if (pf.patient_id && !String(p.id).includes(pf.patient_id.trim())) return false;
    if (pf.barcode && !(p.barcode||'').toLowerCase().includes(pf.barcode.trim().toLowerCase())) return false;
    if (pf.date_from && new Date(p.created_at) < new Date(pf.date_from)) return false;
    if (pf.date_to && new Date(p.created_at) > new Date(pf.date_to+'T23:59:59')) return false;
    if (accPatientIds !== null && !accPatientIds.includes(p.id)) return false;
    return true;
  }), [patients, pf, accPatientIds]);

  const patient = patients.find(p => String(p.id) === String(patientId));
  const orgId = patient?.organization_id || null;
  const orgName = orgId ? (orgs.find(o=>o.id===orgId)?.name || 'Organization') : 'Direct / Walk-in';

  // when patient or picked set changes, re-resolve prices for the picked tests against this org
  useEffect(() => {
    const ids = Object.keys(picked);
    if (!patientId || ids.length === 0) return;
    const qs = `${orgId ? 'organization_id='+orgId+'&' : ''}test_ids=${ids.join(',')}`;
    authedFetch(`/billing/resolve?${qs}`).then(r=>r.ok?r.json():[]).then(rows => {
      setPicked(prev => {
        const next = { ...prev };
        rows.forEach(r => { if (next[r.test_id]) next[r.test_id] = { name:r.name, mrp:r.mrp, price:r.price, source:r.source }; });
        return next;
      });
    }).catch(()=>{});
  }, [patientId]);   // eslint-disable-line

  const addTest = (t) => {
    if (picked[t.id]) return;
    if (groupMemberIds.has(t.id)) { showToast('error', `${t.name} is already included in a selected group`); return; }  // dedupe
    // optimistic base price; the resolve call corrects to group/org price
    setPicked(prev => ({ ...prev, [t.id]: { name:t.name, mrp:t.mrp, price:t.price, source:'base' } }));
    const qs = `${orgId ? 'organization_id='+orgId+'&' : ''}test_ids=${t.id}`;
    authedFetch(`/billing/resolve?${qs}`).then(r=>r.ok?r.json():[]).then(rows => {
      if (rows[0]) setPicked(prev => ({ ...prev, [t.id]: { name:rows[0].name, mrp:rows[0].mrp, price:rows[0].price, source:rows[0].source } }));
    }).catch(()=>{});
  };
  const removeTest = (id) => setPicked(prev => { const n = { ...prev }; delete n[id]; return n; });

  const addGroup = (g) => {
    if (pickedGroups[g.id]) return;
    setPickedGroups(prev => ({ ...prev, [g.id]: g }));
    // dedupe: drop any individually-picked tests that this group covers
    setPicked(prev => {
      const n = { ...prev };
      (g.test_ids || []).forEach(tid => { delete n[tid]; });
      return n;
    });
  };
  const removeGroup = (gid) => setPickedGroups(prev => { const n = { ...prev }; delete n[gid]; return n; });

  // member test ids covered by any selected group (used to dedupe individual tests)
  const groupMemberIds = new Set(Object.values(pickedGroups).flatMap(g => g.test_ids || []));
  const pickedGroupIds = Object.keys(pickedGroups).map(Number);
  const groupSubtotal  = Object.values(pickedGroups).reduce((s,g)=>s+(Number(g.price)||0),0);


  const pickedIds = Object.keys(picked).map(Number);
  const subtotal = useMemo(() => pickedIds.reduce((s,id)=>s+(Number(picked[id].price)||0),0) + groupSubtotal, [picked, pickedGroups]); // eslint-disable-line

  // ordered flat list of every billable test line (group members first, then standalone) -
  // same order the backend uses when auto-assigning accession suffixes, so the preview matches.
  const orderedLineIds = useMemo(() => {
    const ids = [];
    pickedGroupIds.forEach(gid => { const g = pickedGroups[gid]; (g.tests||[]).forEach(t => ids.push(t.id)); });
    pickedIds.forEach(id => ids.push(id));
    return ids;
  }, [pickedGroups, picked]); // eslint-disable-line

  // keep the accession-number preview in sync: assign a default to any new line, drop ones removed, keep manual edits
  useEffect(() => {
    if (!patient) return;
    setAccessions(prev => {
      const next = {};
      orderedLineIds.forEach((tid, idx) => { next[tid] = prev[tid] || `${patient.barcode}${suffixFor(idx)}`; });
      return next;
    });
  }, [orderedLineIds.join(','), patient?.barcode]); // eslint-disable-line

  const setAccession = (tid, val) => setAccessions(prev => ({ ...prev, [tid]: val }));
  const discAmount = useMemo(() => {
    if (!allowDiscount || !discType || !discVal) return 0;
    const v = Number(discVal)||0;
    if (discType==='flat') return Math.min(v, subtotal);
    if (discType==='percent') return Math.round(subtotal*(v/100)*100)/100;
    return 0;
  }, [discType, discVal, subtotal, allowDiscount]);
  const total = Math.max(0, subtotal - discAmount);

  const filtered = tests.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  // load Razorpay checkout script once
  useEffect(() => {
    if (document.getElementById('rzp-sdk')) return;
    const s = document.createElement('script');
    s.id = 'rzp-sdk'; s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    document.body.appendChild(s);
  }, []);

  const refreshBill = async (id) => {
    const b = await authedFetch(`/billing/bills/${id}`).then(r=>r.ok?r.json():null).catch(()=>null);
    if (b) setLastBill(b);
    return b;
  };

  const downloadReceipt = async (bill) => {
    try {
      const res = await authedFetch(`/billing/bills/${bill.id}/receipt`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `Receipt_${bill.bill_no}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast('error', 'Receipt download failed'); }
  };

  // send the Razorpay payment link to the patient's WhatsApp
  const sendBillLink = async () => {
    if (!lastBill) return;
    if (!waPhone.trim()) return showToast('error', 'Enter a WhatsApp number');
    setWaBusy(true);
    try {
      const res = await authedFetch(`/billing/bills/${lastBill.id}/send-whatsapp`, { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ to_number: waPhone.trim(), include_payment_link: true, save_patient_phone: true }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const out = await res.json();
      showToast('success', `Payment link sent to ${waPhone.trim()}`);
      if (out.plink_id) startPolling(out.plink_id);
    } catch (e) { showToast('error', String(e.message||'WhatsApp failed')); }
    setWaBusy(false);
  };

  // poll the payment-link status until paid (CurryCloud-style)
  const startPolling = (plinkId) => {
    setWaiting(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await authedFetch(`/billing/payment-link/${plinkId}/status`);
        if (!r.ok) return;
        const st = await r.json();
        if (st.paid) {
          clearInterval(pollRef.current); pollRef.current = null;
          setWaiting(false);
          const updated = await refreshBill(lastBill.id);
          showToast('success', 'Payment received · receipt ready');
          if (updated) downloadReceipt(updated);   // open the money receipt
        }
      } catch { /* keep polling */ }
    }, 4000);
  };

  const stopWaiting = () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; setWaiting(false); };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);   // eslint-disable-line

  // auto-send the money receipt to WhatsApp once paid (if we have a number)
  const sendReceiptWA = async (bill) => {
    const num = waPhone.trim() || (patient?.phone || '');
    if (!num) return;
    try {
      await authedFetch(`/billing/bills/${bill.id}/send-receipt`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to_number: num }) });
      showToast('success', 'Money receipt sent on WhatsApp');
    } catch { /* non-blocking */ }
  };

  const payCashUpi = async (method) => {
    if (!lastBill) return;
    const due = Math.max(0, (lastBill.total||0) - (lastBill.paid||0));
    if (due <= 0) return;
    setPayingMethod(method);
    try {
      const res = await authedFetch(`/billing/bills/${lastBill.id}/payments`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({ method, amount: due }) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const updated = await res.json();
      setLastBill(updated);
      showToast('success', `Paid ${inr(due)} · receipt ready`);
      downloadReceipt(updated);
      sendReceiptWA(updated);
    } catch (e) { showToast('error', String(e.message||'Payment failed')); }
    setPayingMethod(null);
  };

  const payRazorpay = async () => {
    if (!lastBill) return;
    setPayingMethod('razorpay');
    try {
      const ordRes = await authedFetch(`/billing/bills/${lastBill.id}/razorpay/order`, { method:'POST' });
      if (!ordRes.ok) { const e = await ordRes.json().catch(()=>({})); throw new Error(e.detail||'order failed'); }
      const ord = await ordRes.json();
      if (!window.Razorpay) { setPayingMethod(null); return showToast('error', 'Razorpay not loaded — retry'); }
      const rzp = new window.Razorpay({
        key: ord.key_id, order_id: ord.order_id, amount: ord.amount, currency: ord.currency,
        name: ord.name, description: ord.description,
        handler: async (resp) => {
          try {
            const vRes = await authedFetch(`/billing/bills/${lastBill.id}/razorpay/verify`, { method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) });
            if (!vRes.ok) { const e = await vRes.json().catch(()=>({})); throw new Error(e.detail||'verify failed'); }
            const updated = await refreshBill(lastBill.id);
            showToast('success', 'Payment verified · receipt ready');
            if (updated) { downloadReceipt(updated); sendReceiptWA(updated); }
          } catch (e) { showToast('error', String(e.message||'Verify failed')); }
        },
        modal: { ondismiss: () => { setPayingMethod(null); showToast('error', 'Payment cancelled'); } },
        theme: { color: '#f97316' },
      });
      rzp.open();
    } catch (e) { showToast('error', String(e.message||'Razorpay failed')); }
    setPayingMethod(null);
  };

  // prints 40mm x 25mm-ish labels sized for a typical thermal barcode printer
  const printLabels = (lines) => {
    if (!lines.length) return showToast('error', 'Nothing to print');
    const w = window.open('', '_blank', 'width=420,height=560');
    w.document.write(`<!doctype html><html><head><title>Sample Labels</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
      <style>
        @page { size: 40mm 25mm; margin: 1mm; }
        body{font-family:Arial,sans-serif;margin:0;padding:0;}
        .label{width:40mm;height:25mm;box-sizing:border-box;padding:1mm 1.5mm;page-break-after:always;text-align:center;overflow:hidden;}
        .pname{font-size:6.5pt;font-weight:700;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tname{font-size:6pt;color:#333;margin:0 0 0.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        svg{max-width:100%;height:9mm;}
      </style></head><body>
      ${lines.map(l => `<div class="label">
          <div class="pname">${l.patientName}</div>
          <div class="tname">${l.testName}</div>
          <svg class="bc" data-code="${l.code}"></svg>
        </div>`).join('')}
      <script>
        window.onload = function(){
          document.querySelectorAll('.bc').forEach(function(el){
            JsBarcode(el, el.getAttribute('data-code'), { format:'CODE128', height:26, width:1.3, fontSize:8, margin:0 });
          });
          setTimeout(function(){ window.print(); }, 300);
        };
      </script>
      </body></html>`);
    w.document.close();
  };

  const printAllSamples = () => {
    if (!patient) return;
    const lines = orderedLineIds.map(tid => {
      const testName = picked[tid]?.name
        || Object.values(pickedGroups).flatMap(g=>g.tests||[]).find(t=>t.id===tid)?.name
        || `#${tid}`;
      return { patientName: patient.patient_name, testName, code: accessions[tid] || '' };
    }).filter(l => l.code);
    printLabels(lines);
  };

  const printOneSample = (tid, testName) => {
    if (!patient || !accessions[tid]) return;
    printLabels([{ patientName: patient.patient_name, testName, code: accessions[tid] }]);
  };

  const generate = async () => {
    if (!patientId) return showToast('error', 'Select a patient');
    if (pickedIds.length === 0 && pickedGroupIds.length === 0) return showToast('error', 'Add at least one test or group');
    setSaving(true);
    const payload = {
      patient_id: parseInt(patientId),
      organization_id: orgId,
      test_ids: pickedIds,
      group_ids: pickedGroupIds,
      discount_type: allowDiscount ? (discType || null) : null,
      discount_value: allowDiscount ? (Number(discVal)||0) : 0,
      on_credit: isFranchise ? !!orgId : (onCredit && !!orgId),
      accessions: accessions,
    };
    try {
      const res = await authedFetch('/billing/bills', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail||'failed'); }
      const bill = await res.json();
      setLastBill(bill); setPicked({}); setPickedGroups({}); setDiscType(''); setDiscVal(''); setOnCredit(isFranchise); setAccessions({});
      setWaPhone(patient?.phone || '');
      showToast('success', `Bill ${bill.bill_no} created · ${inr(bill.total)}`);
      downloadReceipt(bill);
    } catch (e) { showToast('error', String(e.message||'Bill failed')); }
    setSaving(false);
  };

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', alignItems:'center', gap:'0.75rem', background:'#fff', borderRadius:'13px', padding:'0.9rem 1.2rem', minWidth:'260px', boxShadow:'0 12px 40px rgba(15,18,24,0.18)', border:'1px solid #eef1f6', borderLeft:`4px solid ${toast.kind==='success'?'#16a34a':'#dc2626'}`, animation:'toastIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <div style={{ width:'30px', height:'30px', borderRadius:'9px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', background: toast.kind==='success'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)' }}>{toast.kind==='success'?'✓':'✕'}</div>
          <div style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f1218' }}>{toast.msg}</div>
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(40px);} to { opacity:1; transform:translateX(0);} } @keyframes spin { to { transform: rotate(360deg);} }`}</style>

      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'inline-flex', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.2)', color:'#f97316', padding:'4px 12px', borderRadius:'100px', fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'0.6rem' }}>Billing</div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2rem', fontWeight:800, color:'#0f1218', letterSpacing:'-0.025em' }}>New Bill</h1>
        <p style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>Prices resolve automatically by the patient's organization (Group → Org → Base).</p>
      </div>

      {/* patient filters */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'0.7rem', alignItems:'end' }}>
          <div><label style={lbl}>Organization</label>
            <select style={inp} value={pf.organization_id} onChange={e=>setPf({...pf,organization_id:e.target.value})}>
              <option value="">All</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <div><label style={lbl}>Branch</label>
            <select style={inp} value={pf.branch_id} onChange={e=>setPf({...pf,branch_id:e.target.value})}>
              <option value="">All</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div><label style={lbl}>From</label><input style={inp} type="date" value={pf.date_from} onChange={e=>setPf({...pf,date_from:e.target.value})} /></div>
          <div><label style={lbl}>To</label><input style={inp} type="date" value={pf.date_to} onChange={e=>setPf({...pf,date_to:e.target.value})} /></div>
          <div><label style={lbl}>Patient ID</label><input style={inp} placeholder="id" value={pf.patient_id} onChange={e=>setPf({...pf,patient_id:e.target.value})} /></div>
          <div><label style={lbl}>Barcode</label><input style={inp} placeholder="barcode" value={pf.barcode} onChange={e=>setPf({...pf,barcode:e.target.value})} /></div>
          <div><label style={lbl}>Accession No.</label><input style={inp} placeholder="e.g. HC21889B" value={pf.accession} onChange={e=>setPf({...pf,accession:e.target.value})} /></div>
        </div>
        {(pf.organization_id||pf.branch_id||pf.date_from||pf.date_to||pf.patient_id||pf.barcode||pf.accession) && (
          <div style={{ marginTop:'0.8rem' }}>
            <button onClick={()=>setPf({ organization_id:'', branch_id:'', date_from:'', date_to:'', patient_id:'', barcode:'', accession:'' })}
              style={{ background:'transparent', color:'#8892a4', border:'1px solid #e8ecf4', borderRadius:'9px', padding:'0.45rem 1rem', cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.78rem' }}>Clear filters</button>
            <span style={{ marginLeft:'0.8rem', fontSize:'0.75rem', color:'#8892a4' }}>{filteredPatients.length} of {patients.length} patients match</span>
          </div>
        )}
      </div>

      {/* patient picker */}
      <div style={{ ...S.card, marginBottom:'1.2rem' }}>
        <div style={{ display:'flex', gap:'1rem', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ minWidth:'320px', flex:1 }}>
            <label style={lbl}>Patient</label>
            <select style={inp} value={patientId} onChange={e=>{ setPatientId(e.target.value); setPicked({}); setPickedGroups({}); setAccessions({}); }}>
              <option value="">— Select patient —</option>
              {filteredPatients.map(p => <option key={p.id} value={p.id}>{p.patient_name} · {p.barcode}</option>)}
            </select>
          </div>
          {patientId && (
            <div style={{ paddingBottom:'0.1rem' }}>
              <label style={lbl}>Billing to</label>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.9rem', fontWeight:700, color: orgId ? '#6366f1' : '#475569' }}>
                {orgId ? '🏥' : '🚶'} {orgName}
              </div>
            </div>
          )}
        </div>
      </div>

      {patientId && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.2rem' }}>
          {/* left: test catalog */}
          <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
            <div style={{ padding:'1rem 1.3rem', borderBottom:'1px solid #f4f6fa' }}>
              <input style={inp} placeholder="Search tests to add…" value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <div style={{ maxHeight:'420px', overflowY:'auto' }}>
              {groups.filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase())).length > 0 && (
                <div style={{ padding:'0.5rem 1.3rem', fontSize:'0.62rem', fontWeight:800, color:'#c2410c', textTransform:'uppercase', letterSpacing:'0.07em', background:'rgba(249,115,22,0.04)' }}>Test Groups</div>
              )}
              {groups.filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase())).map(g => (
                <div key={'g'+g.id} onClick={()=>addGroup(g)}
                  style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.7rem 1.3rem', borderBottom:'1px solid #f7f8fb', cursor: pickedGroups[g.id]?'default':'pointer', background: pickedGroups[g.id]?'rgba(22,163,74,0.05)':'transparent' }}>
                  <span>
                    <span style={{ fontSize:'0.85rem', fontWeight:700, color:'#0f1218' }}>{g.name}</span>
                    <span style={{ fontSize:'0.7rem', color:'#8892a4', marginLeft:'0.4rem' }}>({(g.tests||[]).length} tests)</span>
                  </span>
                  <span style={{ fontSize:'0.8rem', color:'#8892a4' }}>
                    {pickedGroups[g.id] ? <span style={{ color:'#16a34a', fontWeight:700 }}>✓ added</span> : inr(g.price)}
                  </span>
                </div>
              ))}
              {groups.length > 0 && (
                <div style={{ padding:'0.5rem 1.3rem', fontSize:'0.62rem', fontWeight:800, color:'#8892a4', textTransform:'uppercase', letterSpacing:'0.07em', background:'#fafbfc' }}>Individual Tests</div>
              )}
              {filtered.map(t => (
                <div key={t.id} onClick={()=>addTest(t)}
                  style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.7rem 1.3rem', borderBottom:'1px solid #f7f8fb', cursor: (picked[t.id]||groupMemberIds.has(t.id))?'default':'pointer', background: picked[t.id]?'rgba(22,163,74,0.05)':(groupMemberIds.has(t.id)?'#fafbfc':'transparent'), opacity: groupMemberIds.has(t.id)?0.55:1 }}>
                  <span style={{ fontSize:'0.85rem', fontWeight:600, color:'#0f1218' }}>{t.name}</span>
                  <span style={{ fontSize:'0.8rem', color:'#8892a4' }}>
                    {picked[t.id] ? <span style={{ color:'#16a34a', fontWeight:700 }}>✓ added</span> : groupMemberIds.has(t.id) ? <span style={{ color:'#c2410c', fontWeight:600, fontSize:'0.7rem' }}>in group</span> : inr(t.price)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* right: selected + totals */}
          <div style={{ ...S.card }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.8rem' }}>
              <div style={{ fontWeight:800, color:'#0f1218', fontFamily:'Manrope,sans-serif' }}>Bill items</div>
              {(pickedIds.length > 0 || pickedGroupIds.length > 0) && (
                <button onClick={printAllSamples} title="Print sample labels for every line" style={{ background:'rgba(37,99,235,0.1)', color:'#2563eb', border:'1px solid rgba(37,99,235,0.25)', borderRadius:'8px', padding:'0.35rem 0.65rem', fontWeight:700, cursor:'pointer', fontSize:'0.7rem', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap' }}>🖨 Print all Samples</button>
              )}
            </div>
            {pickedIds.length === 0 && pickedGroupIds.length === 0 && <div style={{ color:'#8892a4', fontSize:'0.85rem', padding:'1rem 0' }}>Click tests or groups on the left to add them.</div>}

            {/* selected groups (panels) */}
            {pickedGroupIds.map(gid => { const g = pickedGroups[gid]; return (
              <div key={'g'+gid} style={{ padding:'0.5rem 0', borderBottom:'1px solid #f7f8fb' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <button onClick={()=>removeGroup(gid)} style={{ border:'none', background:'rgba(220,38,38,0.1)', color:'#dc2626', borderRadius:'6px', width:'22px', height:'22px', cursor:'pointer', fontWeight:700 }}>×</button>
                    <span style={{ fontSize:'0.85rem', color:'#0f1218', fontWeight:700 }}>{g.name}</span>
                    <span style={{ fontSize:'0.62rem', background:'rgba(249,115,22,0.12)', color:'#c2410c', padding:'0.12rem 0.5rem', borderRadius:'20px', fontWeight:700 }}>GROUP</span>
                  </div>
                  <span style={{ fontSize:'0.85rem', fontWeight:700, color:'#0f1218' }}>{inr(g.price)}</span>
                </div>
                <div style={{ paddingLeft:'1.9rem', marginTop:'0.3rem', display:'flex', flexDirection:'column', gap:'0.25rem' }}>
                  {(g.tests||[]).map(t => (
                    <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:'0.72rem', color:'#8892a4' }}>• {t.name}</span>
                      <AccessionCell tid={t.id} value={accessions[t.id]||''} onChange={setAccession} onPrint={()=>printOneSample(t.id, t.name)} />
                    </div>
                  ))}
                </div>
              </div>
            ); })}
            {pickedIds.map(id => (
              <div key={id} style={{ padding:'0.5rem 0', borderBottom:'1px solid #f7f8fb' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <button onClick={()=>removeTest(id)} style={{ border:'none', background:'rgba(220,38,38,0.1)', color:'#dc2626', borderRadius:'6px', width:'22px', height:'22px', cursor:'pointer', fontWeight:700 }}>×</button>
                    <span style={{ fontSize:'0.85rem', color:'#0f1218' }}>{picked[id].name}</span>
                    {sourceBadge(picked[id].source)}
                  </div>
                  <span style={{ fontSize:'0.85rem', fontWeight:600, color:'#0f1218' }}>{inr(picked[id].price)}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'0.2rem' }}>
                  <AccessionCell tid={id} value={accessions[id]||''} onChange={setAccession} onPrint={()=>printOneSample(id, picked[id].name)} />
                </div>
              </div>
            ))}


            {/* discount (admin only) */}
            {allowDiscount && (pickedIds.length > 0 || pickedGroupIds.length > 0) && (
              <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
                <label style={lbl}>Discount (admin only)</label>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <select style={{ ...inp, width:'130px' }} value={discType} onChange={e=>setDiscType(e.target.value)}>
                    <option value="">No discount</option>
                    <option value="flat">Flat ₹</option>
                    <option value="percent">Percent %</option>
                  </select>
                  <input style={{ ...inp, width:'110px' }} type="number" disabled={!discType} placeholder={discType==='percent'?'%':'₹'} value={discVal} onChange={e=>setDiscVal(e.target.value)} />
                </div>
              </div>
            )}

            {/* totals */}
            <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid #e8ecf4' }}>
              <Row k="Subtotal" v={inr(subtotal)} />
              {discAmount > 0 && <Row k="Discount" v={'– ' + inr(discAmount)} color="#dc2626" />}
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:'0.5rem' }}>
                <span style={{ fontWeight:800, fontSize:'1.05rem', color:'#0f1218' }}>Total</span>
                <span style={{ fontWeight:800, fontSize:'1.25rem', color:'#16a34a' }}>{inr(total)}</span>
              </div>
            </div>

            {/* credit toggle for B2B */}
            {orgId && (
              <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'1rem', fontSize:'0.82rem', color:'#475569', cursor: isFranchise ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={isFranchise ? true : onCredit} disabled={isFranchise} onChange={e=>setOnCredit(e.target.checked)} style={{ accentColor:'#f97316', width:'16px', height:'16px' }} />
                Bill to organization on credit (adds to {orgName}'s ledger){isFranchise && <span style={{ color:'#c2410c', fontWeight:600 }}> · always on credit</span>}
              </label>
            )}

            <button onClick={generate} disabled={saving || (pickedIds.length===0 && pickedGroupIds.length===0)} style={{ width:'100%', marginTop:'1.2rem', background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'10px', padding:'0.8rem', fontWeight:700, cursor:'pointer', fontSize:'0.95rem', fontFamily:'Manrope,sans-serif', boxShadow:'0 4px 16px rgba(249,115,22,0.3)', opacity: (pickedIds.length===0 && pickedGroupIds.length===0)?0.5:1 }}>
              {saving ? 'Generating…' : `Generate Bill · ${inr(total)}`}
            </button>
          </div>
        </div>
      )}

      {/* last created bill + pay now */}
      {lastBill && (() => {
        const due = Math.max(0, (lastBill.total||0) - (lastBill.paid||0));
        const paid = due <= 0;
        return (
        <div style={{ ...S.card, marginTop:'1.2rem', border:`1px solid ${paid?'rgba(22,163,74,0.4)':'rgba(249,115,22,0.3)'}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontWeight:800, color:'#16a34a', fontSize:'1rem' }}>✓ Bill {lastBill.bill_no} created</div>
              <div style={{ color:'#8892a4', fontSize:'0.82rem', marginTop:'0.2rem' }}>{lastBill.patient_name} · {lastBill.items.length} test(s) · <span style={{ textTransform:'capitalize', fontWeight:700, color: paid?'#16a34a':'#f97316' }}>{lastBill.status}</span></div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontWeight:800, fontSize:'1.3rem', color:'#0f1218' }}>{inr(lastBill.total)}</div>
              {!paid && <div style={{ fontSize:'0.78rem', color:'#dc2626', fontWeight:600 }}>Due {inr(due)}</div>}
            </div>
          </div>

          {isFranchise && (
            <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
              <button onClick={onManageCredit} style={{ background:'rgba(249,115,22,0.1)', color:'#f97316', border:'1.5px solid rgba(249,115,22,0.35)', borderRadius:'9px', padding:'0.6rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>Manage Credit Limit →</button>
              <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.45rem' }}>This bill was added to your organization's credit ledger. Settle outstanding from Manage Credit.</div>
            </div>
          )}

          {/* pay now */}
          {!paid && lastBill.status !== 'credit' && !isFranchise && (
            <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4' }}>
              <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.6rem' }}>Collect Payment</div>
              <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap' }}>
                <button onClick={()=>payCashUpi('cash')} disabled={!!payingMethod} style={payBtn('#16a34a')}>{payingMethod==='cash'?'…':'💵 Cash'}</button>
                <button onClick={()=>payCashUpi('upi')} disabled={!!payingMethod} style={payBtn('#8b5cf6')}>{payingMethod==='upi'?'…':'📲 UPI'}</button>
                <button onClick={payRazorpay} disabled={!!payingMethod} style={payBtn('#3b82f6')}>{payingMethod==='razorpay'?'…':'💳 Razorpay (Online)'}</button>
              </div>

              {/* WhatsApp: send payment link */}
              <div style={{ marginTop:'1rem' }}>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.5rem' }}>Or send payment link on WhatsApp</div>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <input style={{ ...inp, flex:1 }} placeholder="Patient WhatsApp number" value={waPhone} onChange={e=>setWaPhone(e.target.value)} disabled={waiting} />
                  <button onClick={sendBillLink} disabled={waBusy || waiting} style={{ background:'#25D366', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', whiteSpace:'nowrap', opacity: waiting?0.5:1 }}>
                    {waBusy ? 'Sending…' : '💬 Send Bill'}
                  </button>
                </div>
                {waiting ? (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'0.7rem', background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.2)', borderRadius:'9px', padding:'0.6rem 0.9rem' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:'0.5rem', color:'#7c3aed', fontWeight:700, fontSize:'0.82rem' }}>
                      <span style={{ width:'14px', height:'14px', border:'2px solid #c4b5fd', borderTopColor:'#7c3aed', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite' }} />
                      Waiting for customer payment…
                    </span>
                    <button onClick={stopWaiting} style={{ background:'transparent', border:'1px solid #e8ecf4', color:'#8892a4', borderRadius:'7px', padding:'0.3rem 0.8rem', fontSize:'0.78rem', cursor:'pointer' }}>Stop</button>
                  </div>
                ) : (
                  <div style={{ fontSize:'0.72rem', color:'#8892a4', marginTop:'0.4rem' }}>
                    Patient gets a Razorpay link to pay. The money receipt is sent automatically once they pay.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* receipt */}
          {paid && (
            <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px dashed #e8ecf4', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.6rem' }}>
              <span style={{ color:'#16a34a', fontWeight:700, fontSize:'0.85rem' }}>✓ Fully paid — money receipt generated</span>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button onClick={()=>sendReceiptWA(lastBill)} style={{ background:'#25D366', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>💬 Send Receipt</button>
                <button onClick={()=>downloadReceipt(lastBill)} style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'9px', padding:'0.55rem 1.2rem', fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif' }}>⬇ Download Receipt</button>
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

function AccessionCell({ tid, value, onChange, onPrint }) {
  const [editing, setEditing] = useState(false);
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem' }}>
      {editing ? (
        <input autoFocus value={value} onChange={e=>onChange(tid, e.target.value)}
          onBlur={()=>setEditing(false)} onKeyDown={e=>{ if (e.key==='Enter'||e.key==='Escape') setEditing(false); }}
          style={{ fontFamily:'monospace', fontSize:'0.68rem', border:'1.5px solid #f97316', borderRadius:'5px', padding:'0.08rem 0.35rem', width:'92px' }} />
      ) : (
        <span style={{ fontFamily:'monospace', fontSize:'0.68rem', color:'#c2410c', background:'rgba(249,115,22,0.08)', border:'1px dashed rgba(249,115,22,0.3)', borderRadius:'5px', padding:'0.05rem 0.4rem' }}>{value || '—'}</span>
      )}
      <button title="Edit accession no." onClick={()=>setEditing(v=>!v)} style={{ border:'none', background:'transparent', color:'#8892a4', cursor:'pointer', fontSize:'0.75rem', padding:0, lineHeight:1 }}>✎</button>
      <button title="Print this label" onClick={onPrint} style={{ border:'none', background:'transparent', color:'#2563eb', cursor:'pointer', fontSize:'0.75rem', padding:0, lineHeight:1 }}>🖨</button>
    </span>
  );
}

function payBtn(color) {
  return { background:color, color:'#fff', border:'none', borderRadius:'9px', padding:'0.6rem 1.1rem',
           fontWeight:700, cursor:'pointer', fontFamily:'Manrope,sans-serif', fontSize:'0.85rem' };
}

function Row({ k, v, color }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'0.2rem 0' }}>
      <span style={{ color:'#8892a4', fontSize:'0.85rem' }}>{k}</span>
      <span style={{ color: color||'#475569', fontSize:'0.85rem', fontWeight:600 }}>{v}</span>
    </div>
  );
}
