import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Patients from './pages/Patients';
import Results from './pages/Results';
import Simulator from './pages/Simulator';
import TCPLive from './pages/TCPLive';
import TAT from './pages/TAT';
import ChangeStatus from './pages/ChangeStatus';
import Login from './pages/Login';
import { auth } from './services/auth';
import SampleTubes from './pages/SampleTubes';
import OrgGroups from './pages/OrgGroups';
import Organizations from './pages/Organizations';
import Pricing from './pages/Pricing';
import TestsCatalog from './pages/TestsCatalog';
import Users from './pages/Users';
import Billing from './pages/Billing';
import Bills from './pages/Bills';
import ReportValidate from './pages/ReportValidate';
import ValidateHistory from './pages/ValidateHistory';
import HistoryNeeded from './pages/HistoryNeeded';
import HistoryBell from './components/HistoryBell';

export default function App() {
  const [authed, setAuthed] = useState(auth.isAuthed());
  const [page, setPage] = useState('dashboard');
  const [billPatientId, setBillPatientId] = useState('');

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const pages = { dashboard:<Dashboard />, devices:<Devices />, patients:<Patients onBill={(id)=>{ setBillPatientId(String(id)); setPage('billing'); }} />, results:<Results />, simulator:<Simulator />, tcp:<TCPLive />, tat:<TAT />, status:<ChangeStatus />,tubes:<SampleTubes />, orggroups:<OrgGroups />, organizations:<Organizations />, pricing:<Pricing />, testscatalog:<TestsCatalog />, users:<Users />, billing:<Billing initialPatientId={billPatientId} />, bills:<Bills />, reportvalidate:<ReportValidate />, validatehistory:<ValidateHistory />, historyneeded:<HistoryNeeded />  };
  // sidebar/nav handler: opening "New Bill" from the menu starts fresh (no pre-filled patient)
  const handleNav = (p) => { if (p === 'billing') setBillPatientId(''); setPage(p); };
  const logout = () => { auth.logout(); setAuthed(false); setPage('dashboard'); };
  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#f4f6fa' }}>
      <Sidebar current={page} onChange={handleNav} user={auth.user()} onLogout={logout} />
      <main style={{ flex:1, marginLeft:'235px', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
        {/* Top bar */}
        <div style={{ background:'#fff', borderBottom:'1px solid #e8ecf4', padding:'0.85rem 2rem', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40, boxShadow:'0 1px 8px rgba(15,18,24,0.05)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.78rem', color:'#8892a4' }}>
            <span>Home</span>
            <span style={{ color:'#d1d5db' }}>/</span>
           <span style={{ color:'#0f1218', fontWeight:600, textTransform:'capitalize' }}>{page === 'tcp' ? 'Live Connect' : page === 'simulator' ? 'Simulator Test' : page === 'tat' ? 'Turnaround Time' : page === 'status' ? 'Change Report Status' : page === 'tubes' ? 'Sample Tubes' : page === 'orggroups' ? 'Organization Groups' : page === 'organizations' ? 'Organizations' : page === 'pricing' ? 'Group / Org Pricing' : page === 'testscatalog' ? 'Tests Catalog' : page === 'users' ? 'Users & Staff' : page === 'billing' ? 'New Bill' : page === 'bills' ? 'Bills' : page === 'historyneeded' ? 'History Needed' : page}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
            <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#f97316', boxShadow:'0 0 8px rgba(249,115,22,0.6)', animation:'pulse 2s infinite' }}></div>
            <span style={{ fontSize:'0.72rem', color:'#8892a4', fontWeight:600 }}>All systems operational</span><HistoryBell onOpen={()=>setPage('historyneeded')} />
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
