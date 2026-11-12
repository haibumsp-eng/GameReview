import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { configError } from './supabase'
// Font đóng gói cùng app (đủ dấu tiếng Việt, không phụ thuộc máy người dùng).
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/be-vietnam-pro/300.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configError ? <div className="login"><div className="card err" style={{ maxWidth: 480 }}>{configError}</div></div> : <App />}
  </StrictMode>,
)
