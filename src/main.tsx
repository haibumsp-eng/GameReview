import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { configError } from './supabase'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configError ? <div className="login"><div className="card err" style={{ maxWidth: 480 }}>{configError}</div></div> : <App />}
  </StrictMode>,
)
