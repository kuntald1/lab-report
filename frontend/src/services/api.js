const BASE = import.meta.env.VITE_API_URL || "http://localhost:8001/api";

export const api = {
  // Devices
  getDevices:       () => fetch(`${BASE}/devices`).then(r=>r.json()),
  createDevice:     (d) => fetch(`${BASE}/devices`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(r=>r.json()),
  deleteDevice:     (id) => fetch(`${BASE}/devices/${id}`,{method:"DELETE"}).then(r=>r.json()),

  // TCP
  connectDevice:    (id, retry=10) => fetch(`${BASE}/tcp/connect/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({retry_interval:retry})}).then(r=>r.json()),
  disconnectDevice: (id) => fetch(`${BASE}/tcp/disconnect/${id}`,{method:"POST"}).then(r=>r.json()),
  connectAll:       (retry=10) => fetch(`${BASE}/tcp/connect-all`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({retry_interval:retry})}).then(r=>r.json()),
  disconnectAll:    () => fetch(`${BASE}/tcp/disconnect-all`,{method:"POST"}).then(r=>r.json()),
  getDeviceState:   (id) => fetch(`${BASE}/tcp/state/${id}`).then(r=>r.json()),
  getAllStates:      () => fetch(`${BASE}/tcp/states`).then(r=>r.json()),

  // Patients
  getPatients:      () => fetch(`${BASE}/patients`).then(r=>r.json()),
  getPatient:       (barcode) => fetch(`${BASE}/patients/${barcode}`).then(r=>{ if(!r.ok) throw new Error('Not found'); return r.json(); }),
  createPatient:    (p) => fetch(`${BASE}/patients`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(r=>r.json()),

  // Results
  getResults:       () => fetch(`${BASE}/results`).then(r=>r.json()),
  parseData:        (payload) => fetch(`${BASE}/results/parse`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(r=>r.json()),

  // Simulate
  simulateCBC:      (barcode) => fetch(`${BASE}/simulate/astm/cbc?barcode=${barcode}`).then(r=>r.json()),
  simulateBiochem:  (barcode) => fetch(`${BASE}/simulate/astm/biochem?barcode=${barcode}`).then(r=>r.json()),

  // PDF
  downloadPDF: (id) => {
    fetch(`${BASE}/results/${id}/pdf`)
      .then(r=>r.blob())
      .then(blob=>{
        const url = window.URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = `MediCloud_Report_${id}.pdf`; a.click();
        window.URL.revokeObjectURL(url);
      });
  },
};
