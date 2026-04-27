const BASE = atob("aHR0cHM6Ly9tZWRpY2xvdWQubW9vby5jb20vYXBp");

export const api = {
  getDevices: () => fetch(BASE + "/devices").then(r=>r.json()),
  getPatients: () => fetch(BASE + "/patients").then(r=>r.json()),
  getPatient: (b) => fetch(BASE + "/patients/" + b).then(r=>r.json()),
  createPatient: (p) => fetch(BASE + "/patients",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(r=>r.json()),
  getResults: () => fetch(BASE + "/results").then(r=>r.json()),
  createDevice: (d) => fetch(BASE + "/devices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(r=>r.json()),
  deleteDevice: (id) => fetch(BASE + "/devices/" + id,{method:"DELETE"}).then(r=>r.json()),
  connectDevice: (id,retry=10) => fetch(BASE + "/tcp/connect/" + id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({retry_interval:retry})}).then(r=>r.json()),
  disconnectDevice: (id) => fetch(BASE + "/tcp/disconnect/" + id,{method:"POST"}).then(r=>r.json()),
  connectAll: (retry=10) => fetch(BASE + "/tcp/connect-all",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({retry_interval:retry})}).then(r=>r.json()),
  disconnectAll: () => fetch(BASE + "/tcp/disconnect-all",{method:"POST"}).then(r=>r.json()),
  getAllStates: () => fetch(BASE + "/tcp/states").then(r=>r.json()),
  parseData: (payload) => fetch(BASE + "/results/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(r=>r.json()),
  downloadPDF: (id) => { fetch(BASE + "/results/" + id + "/pdf").then(r=>r.blob()).then(blob=>{ const url=window.URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="Report_"+id+".pdf"; a.click(); window.URL.revokeObjectURL(url); }); },
};
