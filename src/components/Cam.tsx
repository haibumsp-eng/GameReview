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
  const [subbing, setSubbing] = useState(false)               // đang chọn người vào thay
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
    if (sel && st && !st.players.some((p) => p.id === sel && p.on)) { setSel(null); setSubbing(false) }
  }, [st, sel])

  if (!st) return <div className="rp rp-center">{err ? <div className="err">{err}</div> : <div className="muted">Đang tải…</div>}</div>
  const running = st.game.running
  const now = running ? Math.max(0, st.game.clock - (Date.now() - fetchedAt.current) / 1000) : st.game.clock
  const team = st.players.filter((p) => p.side === side)
  const on = team.filter((p) => p.on), bench = team.filter((p) => !p.on)
  const me = st.players.find((p) => p.id === sel)
  const name = (s: 'home' | 'away') => (s === 'home' ? st.game.home : st.game.away)

  const score = (pts: number) => { if (me) void call('cam_score', { p_token: token, p_player: me.id, p_pts: pts }, `✓ #${me.number} +${pts}`).then(() => setSel(null)) }
  const pickBench = (p: CPlayer) => {
    if (me) {
      void call('cam_sub', { p_token: token, p_out: me.id, p_in: p.id }, `✓ #${me.number} ra, #${p.number} vào`).then(() => { setSel(null); setSubbing(false) })
    } else {
      void call('cam_sub', { p_token: token, p_out: null, p_in: p.id }, `✓ #${p.number} vào sân`)
    }
  }

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
        <button className={side === 'home' ? 'on atk' : ''} onClick={() => { setSide('home'); setSel(null); setSubbing(false) }}>{name('home')}</button>
        <button className={side === 'away' ? 'on' : ''} onClick={() => { setSide('away'); setSel(null); setSubbing(false) }}>{name('away')}</button>
      </div>
      <div className="sp-group-label">TRÊN SÂN {on.length}/5</div>
      <div className="rp-players">
        {on.map((p) => (
          <button key={p.id} className={`rp-player oncourt ${sel === p.id ? 'sel' : ''}`} onClick={() => { setSel(sel === p.id ? null : p.id); setSubbing(false) }}>
            <b>{p.number}</b><span>{p.name}</span><small>{p.pts} PTS</small>
          </button>
        ))}
        {on.length === 0 && <div className="rp-empty muted">Chưa có ai trên sân: chọn người ở mục Dự bị bên dưới để đưa vào sân.</div>}
      </div>

      <div className="rp-sel">{me ? <>Đang chọn <b>#{me.number} {me.name}</b></> : 'Chọn một cầu thủ trên sân để +điểm hoặc thay người'}</div>
      <div className={`cam-score ${me ? '' : 'idle'}`}>
        <button disabled={busy || !me} onClick={() => score(1)}>+1</button>
        <button disabled={busy || !me} onClick={() => score(2)}>+2</button>
        <button disabled={busy || !me} onClick={() => score(3)}>+3</button>
        <button className={`cam-subbtn ${subbing ? 'on' : ''}`} disabled={busy || !me} onClick={() => setSubbing(!subbing)}>⇄ Thay ra</button>
      </div>

      <div className="sp-group-label">{subbing && me ? `DỰ BỊ: chạm người vào thay #${me.number}` : 'DỰ BỊ'}</div>
      <div className={`rp-players ${subbing || !me ? '' : 'dim'}`}>
        {bench.map((p) => (
          <button key={p.id} className="rp-player" disabled={busy || (!!me && !subbing)} onClick={() => pickBench(p)}>
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
