import { useState, useEffect } from 'react';
import { api } from '../services/api';

const sampleToTest = {
  'Blood':  { type:'Hematology',    template:'cbc',    label:'CBC (Blood Count)',    machine:'Erba H560' },
  'Serum':  { type:'Biochemistry',  template:'biochem',label:'Biochemistry (Serum)', machine:'XL200'     },
  'Plasma': { type:'Biochemistry',  template:'biochem',label:'Biochemistry (Plasma)',machine:'XL200'     },
  'Urine':  { type:'Urine Analyser',template:'biochem',label:'Urine Analysis',       machine:'EM200 IP'  },
};

const TEMPLATES = {
  cbc: (barcode, pid) => [
    'H|\\^&|||Erba H560|||||||P|1',
    'P|1||' + pid + '|||||M',
    'O|1|' + barcode + '||^^^CBC|R',
    'R|1|^^^WBC|7.5|10^3/uL|4.0-11.0|N',
    'R|2|^^^RBC|4.8|10^6/uL|4.5-5.5|N',
    'R|3|^^^HGB|14.2|g/dL|13.0-17.0|N',
    'R|4|^^^HCT|42.0|%|40.0-52.0|N',
    'R|5|^^^PLT|230|10^3/uL|150-400|N',
    'R|6|^^^MCV|88.0|fL|80.0-100.0|N',
    'R|7|^^^MCH|29.5|pg|27.0-33.0|N',
    'R|8|^^^MCHC|33.8|g/dL|32.0-36.0|N',
    'L|1|N',
  ].join('\n'),

  biochem: (barcode, pid) => [
    'H|\\^&|||XL200|||||||P|1',
    'P|1||' + pid + '|||||M',
    'O|1|' + barcode + '||^^^BIOCHEM|R',
    'R|1|^^^GLU|95|mg/dL|70-110|N',
    'R|2|^^^CREA|1.1|mg/dL|0.6-1.2|N',
    'R|3|^^^UREA|28|mg/dL|15-45|N',
    'R|4|^^^ALT|35|U/L|7-56|N',
    'R|5|^^^AST|28|U/L|10-40|N',
    'R|6|^^^CHOL|185|mg/dL|0-200|N',
    'R|7|^^^TRIG|130|mg/dL|0-150|N',
    'L|1|N',
  ].join('\n'),
};

export default function Simulator() {
  const [barcode,    setBarcode]    = useState('');
  const [patient,    setPatient]    = useState(null);
  const [autoInfo,   setAutoInfo]   = useState(null);
  const [rawData,    setRawData]    = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [deviceId,   setDeviceId]   = useState('');
  const [devices,    setDevices]    = useState([]);
  const [result,     setResult]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [searching,  setSearching]  = useState(false);
  const [error,      setError]      = useState('');
  const [notFound,   setNotFound]   = useState(false);

  useEffect(() => {
    api.getDevices().then(setDevices).catch(()=>{});
  }, []);

  const searchPatient = async () => {
    const bc = barcode.trim();
    if(!bc) return;
    setSearching(true);
    setPatient(null); setAutoInfo(null);
    setRawData(''); setResult(null);
    setError(''); setNotFound(false);
    try {
      const p = await api.getPatient(bc);
      if(p && p.id) {
        setPatient(p);
        const info = sampleToTest[p.sample_type] || sampleToTest['Blood'];
        setAutoInfo(info);
        setDeviceType(info.type);
        const pid = p.patient_name.split(' ')[0].toUpperCase();
        setRawData(TEMPLATES[info.template](p.barcode, pid));
        const match = devices.find(d =>
          d.name.toLowerCase().includes(info.machine.toLowerCase().split(' ')[0])
        );
        if(match) setDeviceId(String(match.id));
      } else {
        setNotFound(true);
      }
    } catch(e) {
      setNotFound(true);
    }
    setSearching(false);
  };

  const handleKeyDown = (e) => {
    if(e.key === 'Enter') searchPatient();
  };

  const parse = async () => {
    if(!rawData.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.parseData({
        raw_data:    rawData,
        device_type: deviceType,
        barcode:     barcode.trim(),
        device_id:   deviceId ? parseInt(deviceId) : undefined,
      });
      setResult(res);
    } catch(e) {
      setError('Parse failed. Make sure backend is running.');
    }
    setLoading(false);
  };

  const flagColor  = (f) => f==='H'?'#dc2626':f==='L'?'#2563eb':'#16a34a';
  const flagBg     = (f) => f==='H'?'#fef2f2':f==='L'?'#eff6ff':'#f0fdf4';
  const flagBorder = (f) => f==='H'?'#fecaca':f==='L'?'#bfdbfe':'#bbf7d0';

  const inp = { background:'#fafbfc', border:'1.5px solid #d4e6d6', borderRadius:'8px', padding:'0.65rem 0.9rem', color:'#1c2b1e', fontFamily:'DM Sans,sans-serif', fontSize:'0.88rem', outline:'none', width:'100%' };
  const isReady = patient && rawData && !loading;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', background:'#fef3c7', color:'#92400e', padding:'4px 12px', borderRadius:'100px', fontSize:'11px', fontWeight:600, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'0.6rem', border:'1px solid #fde68a' }}>
          DEMO Tool
        </div>
        <h1 style={{ fontFamily:'Manrope,sans-serif', fontSize:'2.2rem', fontWeight:800, color:'#0f1a10', letterSpacing:'-0.02em' }}>Simulator Test</h1>
        <p style={{ color:'#8892a4', marginTop:'0.3rem', fontWeight:300 }}>
          Enter barcode → click Search → system finds patient → auto-detects test type → simulate machine data.
        </p>
      </div>

      {/* Info */}
      <div style={{ background:'#e8f5e0', border:'1px solid #b8ddb8', borderRadius:'12px', padding:'0.9rem 1.2rem', marginBottom:'1.5rem', display:'flex', alignItems:'center', gap:'0.8rem' }}>
        <span>ℹ️</span>
        <div style={{ fontSize:'0.82rem', color:'#0f1218' }}>
          <strong>Real scenario:</strong> This page is not needed. Real machine sends barcode + results automatically via TCP. This is only for demo/testing.
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>

        {/* LEFT */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {/* STEP 1 — Barcode + Search Button */}
          <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'1.5rem', boxShadow:'0 2px 8px rgba(26,58,28,0.05)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', marginBottom:'1rem' }}>
              <div style={{ width:'26px', height:'26px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'50%', display:'grid', placeItems:'center', fontSize:'0.72rem', fontWeight:800, color:'#fff', flexShrink:0 }}>1</div>
              <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1a10' }}>Enter / Scan Barcode</div>
            </div>

            {/* Barcode input + Search button */}
            <div style={{ display:'flex', gap:'0.6rem', marginBottom:'0.8rem' }}>
              <input
                type="text"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. MC45265601"
                autoFocus
                style={{ ...inp, flex:1, fontSize:'1rem', letterSpacing:'0.05em', fontFamily:'monospace' }}
              />
              <button
                onClick={searchPatient}
                disabled={searching || !barcode.trim()}
                style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'8px', padding:'0.65rem 1.3rem', fontWeight:700, cursor: barcode.trim() ? 'pointer' : 'not-allowed', fontFamily:'DM Sans,sans-serif', fontSize:'0.88rem', whiteSpace:'nowrap', opacity: barcode.trim() ? 1 : 0.5 }}>
                {searching ? '⏳ Searching...' : '🔍 Search'}
              </button>
            </div>

            <div style={{ fontSize:'0.75rem', color:'#8892a4' }}>
              Press <strong>Enter</strong> or click <strong>Search</strong> to find patient
            </div>

            {/* Not found */}
            {notFound && !searching && (
              <div style={{ marginTop:'0.8rem', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', padding:'0.7rem 0.9rem', fontSize:'0.82rem', color:'#dc2626' }}>
                ❌ Patient not found for barcode <strong>{barcode}</strong>. Please register the patient first.
              </div>
            )}

            {/* Patient found */}
            {patient && autoInfo && (
              <div style={{ marginTop:'0.8rem', background:'#e8f5e0', border:'1px solid #b8ddb8', borderRadius:'10px', padding:'1rem' }}>
                <div style={{ fontSize:'0.7rem', color:'#2d6a30', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.7rem' }}>✅ Patient Found — Auto-Detected</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                  {[
                    { label:'Patient Name', value: patient.patient_name },
                    { label:'Barcode',      value: patient.barcode },
                    { label:'Age / Gender', value: (patient.age||'—') + ' / ' + patient.gender },
                    { label:'Doctor',       value: patient.doctor_name || '—' },
                    { label:'Sample Type',  value: patient.sample_type },
                    { label:'Test Type',    value: autoInfo.label },
                    { label:'Machine',      value: autoInfo.machine },
                    { label:'Device Type',  value: autoInfo.type },
                  ].map(item => (
                    <div key={item.label} style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'6px', padding:'0.4rem 0.6rem' }}>
                      <div style={{ fontSize:'0.62rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase' }}>{item.label}</div>
                      <div style={{ fontSize:'0.82rem', color:'#0f1a10', fontWeight:600, marginTop:'0.1rem' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* STEP 2 — Auto ASTM */}
          {patient && (
            <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'1.3rem', boxShadow:'0 2px 8px rgba(26,58,28,0.05)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.8rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
                  <div style={{ width:'26px', height:'26px', background:'linear-gradient(135deg,#f97316,#fbbf24)', borderRadius:'50%', display:'grid', placeItems:'center', fontSize:'0.72rem', fontWeight:800, color:'#fff', flexShrink:0 }}>2</div>
                  <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1a10' }}>Auto-Generated ASTM Data</div>
                </div>
                <span style={{ fontSize:'0.65rem', background:'#e8f5e0', color:'#16a34a', padding:'0.15rem 0.5rem', borderRadius:'4px', fontWeight:700, border:'1px solid #bbf7d0' }}>AUTO ✓</span>
              </div>
              <textarea value={rawData} onChange={e=>setRawData(e.target.value)} rows={11}
                style={{ ...inp, fontFamily:'monospace', fontSize:'0.75rem', resize:'vertical', lineHeight:1.7 }} />
            </div>
          )}

          {/* STEP 3 — Simulate */}
          <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'1.3rem', boxShadow:'0 2px 8px rgba(26,58,28,0.05)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', marginBottom:'1rem' }}>
              <div style={{ width:'26px', height:'26px', background:isReady?'#0f1218':'#e8ecf4', borderRadius:'50%', display:'grid', placeItems:'center', fontSize:'0.72rem', fontWeight:800, color:'#fff', flexShrink:0 }}>3</div>
              <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1a10' }}>Simulate Machine Send</div>
            </div>
            <button onClick={parse} disabled={!isReady}
              style={{ width:'100%', background:isReady?'#0f1218':'#e8ecf4', color:isReady?'#fff':'#8892a4', border:'none', borderRadius:'10px', padding:'1rem', fontWeight:700, cursor:isReady?'pointer':'not-allowed', fontSize:'0.95rem', fontFamily:'Manrope,sans-serif', boxShadow:isReady?'0 4px 16px rgba(26,58,28,0.2)':'', transition:'all 0.2s' }}>
              {loading ? '⏳ Processing...' : '⚡ Simulate Machine → Send to MediCloud'}
            </button>
            {!patient && <div style={{ fontSize:'0.75rem', color:'#8892a4', marginTop:'0.5rem', textAlign:'center' }}>Search for a patient first to enable</div>}
          </div>

          {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', padding:'0.8rem 1rem', color:'#dc2626', fontSize:'0.85rem' }}>{error}</div>}
        </div>

        {/* RIGHT — Result */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          {!result && (
            <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'4rem 2rem', textAlign:'center', color:'#8892a4', boxShadow:'0 2px 8px rgba(26,58,28,0.05)' }}>
              <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>🔬</div>
              <div style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1a10', marginBottom:'0.8rem' }}>Waiting for Data</div>
              <div style={{ fontSize:'0.85rem', fontWeight:300, lineHeight:1.8, color:'#8892a4' }}>
                <div style={{ marginBottom:'0.4rem' }}>1️⃣ Type or scan barcode</div>
                <div style={{ marginBottom:'0.4rem' }}>2️⃣ Click <strong>Search</strong> button</div>
                <div style={{ marginBottom:'0.4rem' }}>3️⃣ Patient auto-found + test detected</div>
                <div>4️⃣ Click Simulate</div>
              </div>
            </div>
          )}

          {result && (
            <>
              <div style={{ background:'#e8f5e0', border:'1.5px solid #b8ddb8', borderRadius:'12px', padding:'1.3rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', marginBottom:'1rem' }}>
                  <span style={{ fontSize:'1.2rem' }}>✅</span>
                  <span style={{ fontFamily:'Manrope,sans-serif', fontWeight:700, color:'#0f1218' }}>Received & Saved to Database</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                  {[
                    { label:'Result ID',  value:'#' + result.result_id },
                    { label:'Barcode',    value: result.barcode },
                    { label:'Patient',    value: result.patient || (patient && patient.patient_name) || '—' },
                    { label:'Parameters',value: result.parameters },
                    { label:'Test',       value: result.parsed && result.parsed.device_type },
                    { label:'Protocol',   value: result.parsed && result.parsed.protocol },
                  ].map(item => (
                    <div key={item.label} style={{ background:'#fff', borderRadius:'6px', padding:'0.5rem 0.7rem', border:'1px solid #d4e6d6' }}>
                      <div style={{ fontSize:'0.68rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', marginBottom:'0.2rem' }}>{item.label}</div>
                      <div style={{ fontSize:'0.85rem', color:'#0f1a10', fontWeight:600 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'1.3rem', boxShadow:'0 2px 8px rgba(26,58,28,0.05)' }}>
                <div style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'1rem' }}>
                  Test Results ({(result.parsed && result.parsed.parameters && result.parsed.parameters.length) || 0} parameters)
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                  {((result.parsed && result.parsed.parameters) || []).map((p, i) => (
                    <div key={i} style={{ background:flagBg(p.flag), border:'1px solid ' + flagBorder(p.flag), borderRadius:'8px', padding:'0.7rem 0.9rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <div>
                        <div style={{ fontSize:'0.85rem', fontWeight:600, color:'#0f1a10' }}>{p.name}</div>
                        <div style={{ fontSize:'0.72rem', color:'#8892a4' }}>Ref: {p.ref_min} – {p.ref_max} {p.unit}</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.7rem' }}>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:'1.1rem', fontWeight:800, color:flagColor(p.flag), fontFamily:'Manrope,sans-serif' }}>{p.value}</div>
                          <div style={{ fontSize:'0.7rem', color:'#8892a4' }}>{p.unit}</div>
                        </div>
                        <span style={{ fontSize:'0.65rem', background:flagColor(p.flag), color:'#fff', padding:'0.2rem 0.5rem', borderRadius:'4px', fontWeight:700 }}>
                          {p.flag==='H'?'HIGH':p.flag==='L'?'LOW':'OK'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background:'#fff', border:'1px solid #d4e6d6', borderRadius:'12px', padding:'1rem 1.3rem', boxShadow:'0 2px 8px rgba(26,58,28,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:'0.85rem', color:'#8892a4' }}>Result saved → download PDF report</div>
                <button onClick={() => api.downloadPDF(result.result_id)}
                  style={{ background:'linear-gradient(135deg,#f97316,#fbbf24)', color:'#fff', border:'none', borderRadius:'8px', padding:'0.5rem 1rem', fontWeight:600, cursor:'pointer', fontSize:'0.8rem', fontFamily:'DM Sans,sans-serif' }}>
                  📄 Download PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
