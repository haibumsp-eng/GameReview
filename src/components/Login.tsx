import { useState } from 'react'
import { useData } from '../store'

export function Login() {
  const { signIn, signUp } = useData()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setMsg(null)
    const r = mode === 'in' ? await signIn(email, password) : await signUp(email, password, name)
    setMsg(r); setBusy(false)
  }

  return (
    <div className="login">
      <div className="card stack login-card">
        <div className="logo"><span className="dot" />GAME<b>REVIEW</b></div>
        {mode === 'up' && <input placeholder="Tên của bạn (hiển thị khi bình luận)" value={name} onChange={(e) => setName(e.target.value)} />}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {msg && <div className="err">{msg}</div>}
        <button className="btn primary" disabled={busy || !email || !password} onClick={submit}>{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        <button className="btn sm" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}>
          {mode === 'in' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </div>
    </div>
  )
}
