import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { Logo } from './Logo'

interface CPlayer { id: string; side: 'home' | 'away'; number: number; name: string; on: boolean; pts: number; pf: number }
interface CState {
  game: { title: string; home: string; away: string; period: number; clock: number; running: boolean }
  score: { home: number; away: number }
  players: CPlayer[]
  period_len: number
  mark: { at: string | null; clock: number | null }
}
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)
const hms = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Điện thoại ở phía máy quay (không cần đăng nhập): đồng hồ, thay người, +điểm và đánh dấu bắt đầu trận.
 * Mở bằng #cam=<mã QR>. Chỉ làm được bốn việc này.
 */
export function CamPad({ token }: { token: string }) {
  const [st, setSt] = useState<CState | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [side, setSide] = useState<'home' | 'away'>('home')
  const [sel, setSel] = useState<string | null>(null)       // người đang chọn (trên sân)
  const [outId, setOutId] = useState<string | null>(null)       // người đã chạm 2 lần để ra sân, chờ chọn người vào
  const lastTap = useRef<{ id: string; at: number } | null>(null)
  const fetchedAt = useRef(Date.now())
  const [, tick] = useState(0)

  const load = async () => {
    const { data, error } = await supabase.rpc('cam_state', { p_token: token })
    if (error) return setErr('Mất kết nối, đang thử lại…')
    if ((data as { error?: string })?.error) return setErr((data as { error: string }).error)
    setErr(''); fetchedAt.current = Date.now(); setSt(data as CState)
  }
  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 2000)
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => { clearInterval(iv); clearInterval(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1800) }
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || data !== 'ok') return flash(error?.message ?? String(data))
    navigator.vibrate?.(30)
    flash(ok); void load()
  }
  const clock = (a: string, secs = 0, ok = '✓') => call('cam_clock', { p_token: token, p_action: a, p_secs: secs }, ok)

  useEffect(() => {
    if (sel && st && !st.players.some((p) => p.id === sel && p.on)) setSel(null)
    if (outId && st && !st.players.some((p) => p.id === outId && p.on)) setOutId(null)
  }, [st, sel, outId])

  if (!st) return <div className="rp rp-center">{err ? <div className="err">{err}</div> : <div className="muted">Đang tải…</div>}</div>
  const running = st.game.running
  const now = running ? Math.max(0, st.game.clock - (Date.now() - fetchedAt.current) / 1000) : st.game.clock
  const team = st.players.filter((p) => p.side === side)
  const on = team.filter((p) => p.on), bench = team.filter((p) => !p.on)
  const me = st.players.find((p) => p.id === sel)
  const name = (s: 'home' | 'away') => (s === 'home' ? st.game.home : st.game.away)

  const score = (pts: number) => { if (me) void call('cam_score', { p_token: token, p_player: me.id, p_pts: pts }, `✓ #${me.number} +${pts}`).then(() => setSel(null)) }
  const outP = st.players.find((p) => p.id === outId)
  // Người trên sân: chạm 1 lần = chọn (để +điểm); chạm 2 lần liên tiếp = cho ra sân (rồi chạm người dự bị để vào).
  const tapCourt = (p: CPlayer) => {
    const t = Date.now(), last = lastTap.current
    if (last && last.id === p.id && t - last.at < 450) {
      lastTap.current = null
      navigator.vibrate?.(40)
      setSel(null); setOutId(p.id)
      return
    }
    lastTap.current = { id: p.id, at: t }
    setOutId(null)
    setSel(sel === p.id ? null : p.id)
  }
  // Người dự bị: chạm = vào sân (thay cho người vừa cho ra; hoặc vào thẳng nếu sân chưa đủ 5 người).
  const pickBench = (p: CPlayer) => {
    if (outP) {
      void call('cam_sub', { p_token: token, p_out: outP.id, p_in: p.id }, `✓ #${outP.number} ra, #${p.number} vào`).then(() => setOutId(null))
    } else if (on.length < 5) {
      void call('cam_sub', { p_token: token, p_out: null, p_in: p.id }, `✓ #${p.number} vào sân`)
    } else flash('Chạm 2 lần vào người trên sân để cho ra trước')
  }
  const outOnly = () => { if (outP) void call('cam_sub', { p_token: token, p_out: outP.id, p_in: null }, `✓ #${outP.number} ra sân`).then(() => setOutId(null)) }

  return (
    <div className="rp cam">
      <div className="rp-head"><Logo size={22} /><span className="muted rp-title">Máy quay · {st.game.title}</span></div>
      <div className="rp-score">
        <span className="rp-tname">{st.game.home}</span><b className="home">{st.score.home}</b>
        <span className={`rp-clock ${running ? 'run' : ''}`}>{qLabel(st.game.period)}</span>
        <b className="away">{st.score.away}</b><span className="rp-tname">{st.game.away}</span>
      </div>

      <div className="cam-clock">
        <div className={`cam-time ${running ? 'run' : ''}`}>{mmss(now)}</div>
        <button className={`cam-go ${running ? 'stop' : ''}`} disabled={busy || (!running && now <= 0)} onClick={() => clock(running ? 'stop' : 'start', 0, running ? '⏸ Đã dừng' : '▶ Đồng hồ chạy')}>
          {running ? '⏸ DỪNG' : '▶ CHẠY'}
        </button>
      </div>
      <div className="cam-adj">
        <button disabled={busy} onClick={() => clock('adjust', -10)}>−10s</button>
        <button disabled={busy} onClick={() => clock('adjust', -1)}>−1s</button>
        <button disabled={busy} onClick={() => clock('adjust', 1)}>+1s</button>
        <button disabled={busy} onClick={() => clock('adjust', 10)}>+10s</button>
        <button disabled={busy || st.game.period <= 1} onClick={() => clock('prev', 0, '✓ Hiệp trước')}>‹ Hiệp</button>
        <button disabled={busy} onClick={() => clock('next', 0, '✓ Hiệp kế')}>Hiệp ›</button>
      </div>
      <div className="cam-mark">
        {st.mark.at
          ? <><span>🏁 Bắt đầu trận lúc <b>{hms(st.mark.at)}</b> (đồng hồ {mmss(st.mark.clock ?? 0)})</span>
              <button className="cam-link" disabled={busy} onClick={() => call('cam_mark_start', { p_token: token, p_on: false }, 'Đã xoá mốc')}>Xoá mốc</button></>
          : <button className="cam-markbtn" disabled={busy || !running} onClick={() => call('cam_mark_start', { p_token: token, p_on: true }, '🏁 Đã đánh dấu bắt đầu trận')}>
              🏁 Đánh dấu bắt đầu trận{running ? '' : ' (chạy đồng hồ trước)'}</button>}
      </div>

      {err && <div className="err">{err}</div>}
      <div className="seg-toggle rp-sides">
        <button className={side === 'home' ? 'on atk' : ''} onClick={() => { setSide('home'); setSel(null); setOutId(null) }}>{name('home')}</button>
        <button className={side === 'away' ? 'on' : ''} onClick={() => { setSide('away'); setSel(null); setOutId(null) }}>{name('away')}</button>
      </div>
      <div className="sp-group-label">TRÊN SÂN {on.length}/5 · chạm 1 lần để chọn, <b>chạm 2 lần để cho ra</b></div>
      <div className="rp-players">
        {on.map((p) => (
          <button key={p.id} className={`rp-player oncourt ${sel === p.id ? 'sel' : ''} ${outId === p.id ? 'going' : ''}`} onClick={() => tapCourt(p)}>
            <b>{p.number}</b><span>{p.name}</span><small>{outId === p.id ? 'RA SÂN' : `${p.pts} PTS`}</small>
          </button>
        ))}
        {on.length === 0 && <div className="rp-empty muted">Chưa có ai trên sân: chạm người ở mục Dự bị bên dưới để đưa vào sân.</div>}
      </div>

      {outP ? (
        <div className="cam-out">
          <span><b>#{outP.number} {outP.name}</b> ra sân. Chạm người dự bị để vào.</span>
          <button onClick={outOnly} disabled={busy}>Chỉ cho ra</button>
          <button onClick={() => setOutId(null)}>Huỷ</button>
        </div>
      ) : (
        <>
          <div className="rp-sel">{me ? <>Đang chọn <b>#{me.number} {me.name}</b></> : 'Chạm một cầu thủ trên sân để +điểm'}</div>
          <div className={`cam-score ${me ? '' : 'idle'}`}>
            <button disabled={busy || !me} onClick={() => score(1)}>+1</button>
            <button disabled={busy || !me} onClick={() => score(2)}>+2</button>
            <button disabled={busy || !me} onClick={() => score(3)}>+3</button>
          </div>
        </>
      )}

      <div className="sp-group-label">{outP ? `DỰ BỊ: chạm người vào thay #${outP.number}` : on.length < 5 ? 'DỰ BỊ: chạm để vào sân' : 'DỰ BỊ'}</div>
      <div className={`rp-players ${on.length >= 5 && !outP ? 'dim' : ''}`}>
        {bench.map((p) => (
          <button key={p.id} className={`rp-player bench ${outP ? 'ready' : ''}`} disabled={busy} onClick={() => pickBench(p)}>
            <b>{p.number}</b><span>{p.name}</span>
          </button>
        ))}
        {bench.length === 0 && <div className="rp-empty muted">Không có dự bị.</div>}
      </div>
      <div className="row"><span className="grow muted small-note">Pha +2 / +3 chờ người bấm stats bổ sung vị trí.</span><button className="btn sm" disabled={busy} onClick={() => call('cam_undo', { p_token: token }, '↶ Đã hoàn tác')}>↶ Hoàn tác</button></div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
