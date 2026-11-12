import { useState } from 'react'
import { Logo } from './Logo'
import { useData } from '../store'

export function Login() {
  const { signIn, signUp } = useData()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setMsg(null)
    const r = mode === 'in' ? await signIn(login, password) : await signUp(login, password, name)
    setMsg(r); setBusy(false)
  }

  return (
    <div className="login login-hero">
      <div className="login-side">
        <div className="login-intro">
          <Logo size={46} />
          <h1>Mổ băng trận đấu<br /><span>cho HLV bóng rổ</span></h1>
          <p>Đánh dấu tình huống tấn công, phòng thủ theo từng hiệp. Lọc theo cầu thủ, bình luận và xem lại thành playlist.</p>
        </div>
      <div className="card stack login-card">
        <div className="login-title">{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</div>
        {mode === 'up' && <input placeholder="Tên của bạn (hiển thị khi bình luận)" value={name} onChange={(e) => setName(e.target.value)} />}
        <input placeholder="Tên đăng nhập hoặc email" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} />
        <input type="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {msg && <div className="err">{msg}</div>}
        <button className="btn primary" disabled={busy || !login || !password} onClick={submit}>{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        <button className="btn sm" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}>
          {mode === 'in' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
        {mode === 'up' && <div className="muted">Dùng tên đăng nhập ngắn (vd: coachhai) hoặc email đều được.</div>}
      </div>
      </div>
    </div>
  )
}
