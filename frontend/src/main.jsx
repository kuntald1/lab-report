import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicReport from './pages/PublicReport';
import './index.css';

// QR landing: when the URL carries a report id (?rid=..&k=..), show the public
// report viewer instead of the authenticated app. No login required.
const isPublicReport = new URLSearchParams(window.location.search).has('rid');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPublicReport ? <PublicReport /> : <App />}
  </React.StrictMode>
);
