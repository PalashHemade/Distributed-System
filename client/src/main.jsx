import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

// The auth JWT lives in an httpOnly cookie now (see server/controllers/authController.js)
// — every axios call needs to carry it, so set this once globally rather than
// repeating `{ withCredentials: true }` at every call site.
axios.defaults.withCredentials = true;

window.addEventListener('error', (event) => {
  console.error('[FRONTEND ERROR]', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[FRONTEND PROMISE ERROR]', event.reason);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
