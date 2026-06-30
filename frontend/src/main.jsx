import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicReport from './pages/PublicReport';
import './index.css';

// QR landing: when the URL carries a report id (?rid=..&k=..) or a patient id
// (?pid=..&k=.., from a Direct/Walk-in money receipt), show the public report
// viewer instead of the authenticated app. No login required.
const qs = new URLSearchParams(window.location.search);
const isPublicReport = qs.has('rid') || qs.has('pid');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPublicReport ? <PublicReport /> : <App />}
  </React.StrictMode>
);
