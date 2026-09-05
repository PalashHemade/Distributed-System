import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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
