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
export function BoardOverlay({ token, pos, scale, inline, bonus }: { token: string; pos: 'top' | 'bottom'; scale: number; inline?: boolean; bonus?: { home: number; away: number } }) {
  const [st, setSt] = useState<BState | null>(null)
  const [err, setErr] = useState('')
  const fetchedAt = useRef(Date.now())
  const [, tick] = useState(0)
  const prev = useRef<{ home: number; away: number } | null>(null)
  // Hiệu ứng ghi điểm: 1 điểm nhẹ, 2 điểm vừa, 3 điểm mạnh (tăng nhiều hơn trong 1 lần tải thì tính theo mức 3).
  const [fx, setFx] = useState<{ side: 'home' | 'away'; pts: number; n: number } | null>(null)
  const fxN = useRef(0)

  useEffect(() => {
    if (inline) return // xem trước ngay trong app: không đổi nền cả trang
    document.documentElement.classList.add('obs')
    return () => document.documentElement.classList.remove('obs')
  }, [inline])

  const load = async () => {
    const { data, error } = await supabase.rpc('remote_state', { p_token: token })
    if (error) return setErr('Mất kết nối, đang thử lại…')
    const d = data as { error?: string } & BState
    if (d?.error) return setErr(d.error)
    setErr(''); fetchedAt.current = Date.now()
    setSt(d)
  }
  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 1500)
    const t = setInterval(() => tick((n) => n + 1), 200)
    return () => { clearInterval(iv); clearInterval(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Điểm hiển thị = điểm thật (+ điểm thử khi xem trước). Tăng lên thì chạy hiệu ứng.
  const shownH = (st?.score.home ?? 0) + (bonus?.home ?? 0), shownA = (st?.score.away ?? 0) + (bonus?.away ?? 0)
  useEffect(() => {
    if (!st) return
    const pv = prev.current
    if (pv) {
      const dh = shownH - pv.home, da = shownA - pv.away
      if (dh > 0 || da > 0) setFx({ side: dh >= da ? 'home' : 'away', pts: Math.max(dh, da), n: ++fxN.current })
    }
    prev.current = { home: shownH, away: shownA }
  }, [shownH, shownA]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fx) return
    const t = setTimeout(() => setFx(null), fx.pts >= 3 ? 2200 : fx.pts === 2 ? 1300 : 800)
    return () => clearTimeout(t)
  }, [fx])

  if (!st) return err ? <div className="obs-err">{err}</div> : null
  const tier = fx ? Math.min(3, fx.pts) : 0
  const effect = (side: 'home' | 'away') => {
    if (!fx || fx.side !== side) return null
    return (
      <div className={`obs-fx t${tier} ${side} ${pos}`} key={fx.n}>
        <span className="obs-tag">+{fx.pts}</span>
        {tier >= 2 && <span className="obs-ring" />}
        {tier === 3 && Array.from({ length: 12 }, (_, i) => <i key={i} className="obs-spark" style={{ ['--a' as string]: `${i * 30}deg`, ['--d' as string]: `${70 + (i % 3) * 22}px` }} />)}
      </div>
    )
  }
  const clock = st.game.running ? st.game.clock - (Date.now() - fetchedAt.current) / 1000 : st.game.clock

  return (
    <div className={`obs-wrap ${pos} ${inline ? 'inline' : ''}`} style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: pos === 'top' ? 'top center' : 'bottom center' }}>
      <div className={`obs-bar ${fx ? `fx${tier} ${fx.side}` : ''}`}>
        <div className="obs-team home"><span className="obs-name">{st.game.home}</span></div>
        <div className={`obs-score home ${fx?.side === 'home' ? `fx${tier}` : ''}`} key={`h${shownH}`}>{shownH}{effect('home')}</div>
        <div className="obs-mid">
          <span className="obs-q">{qLabel(st.game.period)}</span>
          <span className={`obs-clock ${st.game.running ? 'run' : ''}`}>{mmss(clock)}</span>
        </div>
        <div className={`obs-score away ${fx?.side === 'away' ? `fx${tier}` : ''}`} key={`a${shownA}`}>{shownA}{effect('away')}</div>
        <div className="obs-team away"><span className="obs-name">{st.game.away}</span></div>
      </div>
      {err && <div className="obs-err small">{err}</div>}
    </div>
  )
}
