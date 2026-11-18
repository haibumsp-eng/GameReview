import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

interface BState { game: { title: string; home: string; away: string; period: number; clock: number; running: boolean }; score: { home: number; away: number } }
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)

/**
 * Bảng tỉ số cho livestream (OBS → Browser Source). Nền trong suốt, không cần đăng nhập.
 * Địa chỉ: <trang>#board=<mã>&pos=top|bottom&scale=1.2
 * Chỉ ĐỌC: lấy tên đội, tỉ số, hiệp, đồng hồ từ trận đang bấm stats.
 */
export function BoardOverlay({ token, pos, scale }: { token: string; pos: 'top' | 'bottom'; scale: number }) {
  const [st, setSt] = useState<BState | null>(null)
  const [err, setErr] = useState('')
  const fetchedAt = useRef(Date.now())
  const [, tick] = useState(0)
  const prev = useRef({ home: 0, away: 0 })
  const [flash, setFlash] = useState<'' | 'home' | 'away'>('')

  useEffect(() => {
    document.documentElement.classList.add('obs')
    return () => document.documentElement.classList.remove('obs')
  }, [])

  const load = async () => {
    const { data, error } = await supabase.rpc('remote_state', { p_token: token })
    if (error) return setErr('Mất kết nối, đang thử lại…')
    const d = data as { error?: string } & BState
    if (d?.error) return setErr(d.error)
    setErr(''); fetchedAt.current = Date.now()
    if (d.score.home !== prev.current.home) setFlash('home')
    else if (d.score.away !== prev.current.away) setFlash('away')
    prev.current = { ...d.score }
    setSt(d)
  }
  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 1500)
    const t = setInterval(() => tick((n) => n + 1), 200)
    return () => { clearInterval(iv); clearInterval(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 1200); return () => clearTimeout(t) }, [flash])

  if (!st) return err ? <div className="obs-err">{err}</div> : null
  const clock = st.game.running ? st.game.clock - (Date.now() - fetchedAt.current) / 1000 : st.game.clock

  return (
    <div className={`obs-wrap ${pos}`} style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: pos === 'top' ? 'top center' : 'bottom center' }}>
      <div className="obs-bar">
        <div className="obs-team home"><span className="obs-name">{st.game.home}</span></div>
        <div className={`obs-score home ${flash === 'home' ? 'pop' : ''}`} key={`h${st.score.home}`}>{st.score.home}</div>
        <div className="obs-mid">
          <span className="obs-q">{qLabel(st.game.period)}</span>
          <span className={`obs-clock ${st.game.running ? 'run' : ''}`}>{mmss(clock)}</span>
        </div>
        <div className={`obs-score away ${flash === 'away' ? 'pop' : ''}`} key={`a${st.score.away}`}>{st.score.away}</div>
        <div className="obs-team away"><span className="obs-name">{st.game.away}</span></div>
      </div>
      {err && <div className="obs-err small">{err}</div>}
    </div>
  )
}
