import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Patients from './pages/Patients';
import Results from './pages/Results';
import Simulator from './pages/Simulator';
import TCPLive from './pages/TCPLive';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const pages = { dashboard:<Dashboard />, devices:<Devices />, patients:<Patients />, results:<Results />, simulator:<Simulator />, tcp:<TCPLive /> };
  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#f4f6fa' }}>
      <Sidebar current={page} onChange={setPage} />
      <main style={{ flex:1, marginLeft:'235px', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
        {/* Top bar */}
        <div style={{ background:'#fff', borderBottom:'1px solid #e8ecf4', padding:'0.85rem 2rem', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40, boxShadow:'0 1px 8px rgba(15,18,24,0.05)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.78rem', color:'#8892a4' }}>
            <span>Home</span>
            <span style={{ color:'#d1d5db' }}>/</span>
            <span style={{ color:'#0f1218', fontWeight:600, textTransform:'capitalize' }}>{page === 'tcp' ? 'Live Connect' : page === 'simulator' ? 'Simulator Test' : page}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
            <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#f97316', boxShadow:'0 0 8px rgba(249,115,22,0.6)', animation:'pulse 2s infinite' }}></div>
            <span style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600 }}>All systems operational</span>
          </div>
        </div>
        {/* Page content */}
        <div style={{ flex:1, padding:'2rem', maxWidth:'100%' }}>
          {pages[page] || <Dashboard />}
        </div>
      </main>
    </div>
  );
}
