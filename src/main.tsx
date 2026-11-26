import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { configError } from './supabase'
import { RemotePad } from './components/Remote'
import { CamPad } from './components/Cam'
import { BoardOverlay } from './components/Board'
import { ScorePad } from './components/ScorePad'
import { DialogHost } from './components/DialogHost'
// Font đóng gói cùng app (đủ dấu tiếng Việt, không phụ thuộc máy người dùng).
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/be-vietnam-pro/300.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import './styles.css'

// Điện thoại quét QR: #remote=<token> → chỉ hiện bảng bấm, không cần đăng nhập.
// Điện thoại máy quay: #cam=<token> → chỉ đồng hồ, thay người, +điểm, đánh dấu bắt đầu trận.
const camToken = location.hash.match(/cam=([0-9a-f]{16,64})/)?.[1]
const remoteToken = location.hash.match(/remote=([0-9a-f]{16,64})/)?.[1]
// OBS: #board=<token>&pos=top|bottom&scale=1 → bảng tỉ số nền trong suốt.
// Điện thoại điều khiển bảng tỉ số: #scorepad=<control_token> (không đăng nhập).
const padToken = location.hash.match(/scorepad=([0-9a-f]{16,64})/)?.[1]
const boardToken = location.hash.match(/board=([0-9a-f]{16,64})/)?.[1]
const boardPos = /pos=bottom/.test(location.hash) ? 'bottom' : 'top'
const boardScale = Math.min(3, Math.max(0.4, parseFloat(location.hash.match(/scale=([0-9.]+)/)?.[1] ?? '1') || 1))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configError ? <div className="login"><div className="card err" style={{ maxWidth: 480 }}>{configError}</div></div>
      : padToken ? <ScorePad token={padToken} />
      : boardToken ? <BoardOverlay token={boardToken} pos={boardPos} scale={boardScale} />
      : camToken ? <CamPad token={camToken} />
      : remoteToken ? <RemotePad token={remoteToken} /> : <><App /><DialogHost /></>}
  </StrictMode>,
)
