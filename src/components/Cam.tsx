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
  const [side, setSide] = useState<'home' | 'away'>('home')
  const [sel, setSel] = useState<string | null>(null)       // người đang chọn (trên sân)
  const [outId, setOutId] = useState<string | null>(null)       // người đã chạm 2 lần để ra sân, chờ chọn người vào
  const [editing, setEditing] = useState<string | null>(null) // đang nhập giờ (chuỗi người dùng gõ)
  const [armReset, setArmReset] = useState(false)
  const [panel, setPanel] = useState<null | 'time'>(null) // bảng chỉnh giờ (±1s, ±10s, reset, hiệp) chỉ hiện khi bấm
  const lastTap = useRef<{ id: string; at: number } | null>(null)
  const [armMark, setArmMark] = useState(false)
  const fetchedAt = useRef(Date.now())
  const stRef = useRef<CState | null>(null)
  const inflight = useRef(0)   // số thao tác đã bấm mà máy chủ chưa trả lời
  const rtt = useRef(0)        // thời gian khứ hồi gần nhất (ms), dùng bù trễ cho đồng hồ
  const [, tick] = useState(0)

  const load = async () => {
    const t0 = Date.now()
    const { data, error } = await supabase.rpc('cam_state', { p_token: token })
    const t1 = Date.now()
    if (error) return setErr('Mất kết nối, đang thử lại…')
    if ((data as { error?: string })?.error) return setErr((data as { error: string }).error)
    rtt.current = t1 - t0
    // Đang có thao tác chưa được máy chủ xác nhận: không ghi đè trạng thái tạm thời (tránh nhảy lùi).
    if (inflight.current > 0) return
    setErr(''); fetchedAt.current = (t0 + t1) / 2 // giờ trả về là giờ ở giữa chuyến đi
    stRef.current = data as CState; setSt(data as CState)
  }
  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 1500)
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => { clearInterval(iv); clearInterval(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1800) }
  /** Giờ đang hiển thị trên đồng hồ (giây). */
  const shownClock = () => { const c = stRef.current; return !c ? 0 : c.game.running ? Math.max(0, c.game.clock - (Date.now() - fetchedAt.current) / 1000) : c.game.clock }
  /** Cập nhật giao diện NGAY (không chờ mạng), gửi lên máy chủ ở nền, xong thì đối chiếu lại. */
  const call = (fn: string, args: Record<string, unknown>, ok: string, optimistic?: (c: CState) => CState) => {
    if (optimistic && stRef.current) { const n = optimistic(stRef.current); stRef.current = n; setSt(n) }
    navigator.vibrate?.(30)
    flash(ok)
    inflight.current++
    return supabase.rpc(fn, args).then(({ data, error }) => {
      inflight.current--
      if (error || data !== 'ok') flash(error?.message ?? String(data))
      void load() // đối chiếu với máy chủ (nếu máy chủ từ chối thì trạng thái tạm bị sửa lại)
    })
  }
  const clock = (a: string, secs = 0, ok = '✓', optimistic?: (c: CState) => CState) =>
    call('cam_clock', { p_token: token, p_action: a, p_secs: secs, p_lag_ms: a === 'start' || a === 'stop' ? Math.round(rtt.current / 2) : 0 }, ok, optimistic)
  const withClock = (c: CState, v: Partial<CState['game']>, now: number): CState => { fetchedAt.current = Date.now(); return { ...c, game: { ...c.game, clock: now, ...v } } }

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

  // Gõ giờ: "7:32", "732" (= 7:32), "45" (= 0:45), "1000" (= 10:00).
  const parseTime = (t: string): number | null => {
    const v = t.trim()
    let m: number, sec: number
    if (v.includes(':')) { const [a, b] = v.split(':'); m = +a; sec = +b } else { const d = v.replace(/\D/g, ''); if (!d) return null; sec = +d.slice(-2); m = +(d.slice(0, -2) || 0) }
    if (isNaN(m) || isNaN(sec) || sec > 59) return null
    return m * 60 + sec
  }
  const commitTime = () => {
    if (editing === null || !st) return
    const v = parseTime(editing)
    if (v === null) return flash('Nhập dạng 7:32 hoặc 732 (giây từ 00 đến 59)')
    if (v > (st.game.period <= 4 ? st.period_len : 300)) return flash('Vượt quá độ dài một hiệp')
    setEditing(null)
    const n = v
    void call('cam_clock', { p_token: token, p_action: 'set', p_secs: n, p_lag_ms: 0 }, `✓ Đặt giờ ${mmss(n)}`, (c) => withClock(c, {}, n))
  }
  const resetClock = () => {
    if (!armReset) { setArmReset(true); setTimeout(() => setArmReset(false), 3000); return }
    setArmReset(false)
    void clock('reset', 0, '↺ Đã đặt lại giờ hiệp', (c) => withClock(c, { running: false }, c.game.period <= 4 ? c.period_len : 300))
  }
  const adj = (d: number) => { const n = shownClock(); clock('adjust', d, '✓', (c) => withClock(c, {}, Math.min(st.period_len, Math.max(0, n + d)))) }
  const per = (d: number) => clock(d > 0 ? 'next' : 'prev', 0, d > 0 ? '✓ Hiệp kế' : '✓ Hiệp trước', (c) => withClock(c, { period: Math.max(1, c.game.period + d), running: false }, c.period_len))
  const score = (pts: number) => {
    if (!me) return
    const id = me.id, sd = me.side
    setSel(null)
    void call('cam_score', { p_token: token, p_player: id, p_pts: pts }, `✓ #${me.number} +${pts}`, (c) => ({
      ...c, score: { ...c.score, [sd]: c.score[sd] + pts }, players: c.players.map((p) => (p.id === id ? { ...p, pts: p.pts + pts } : p)),
    }))
  }
  const setOn = (c: CState, out: string | null, inn: string | null): CState => ({ ...c, players: c.players.map((p) => (p.id === out ? { ...p, on: false } : p.id === inn ? { ...p, on: true } : p)) })
  const outP = st.players.find((p) => p.id === outId)
  // Người trên sân luôn hiện: chạm 1 lần = chọn (để +điểm); chạm 2 lần liên tiếp = cho ra sân, lúc đó mới hiện dự bị để chọn người vào.
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
  const pickBench = (p: CPlayer) => {
    if (outP) {
      const o = outP; setOutId(null)
      void call('cam_sub', { p_token: token, p_out: o.id, p_in: p.id }, `✓ #${o.number} ra, #${p.number} vào`, (c) => setOn(c, o.id, p.id))
    } else if (on.length < 5) {
      void call('cam_sub', { p_token: token, p_out: null, p_in: p.id }, `✓ #${p.number} vào sân`, (c) => setOn(c, null, p.id))
    }
  }
  const outOnly = () => { if (!outP) return; const o = outP; setOutId(null); void call('cam_sub', { p_token: token, p_out: o.id, p_in: null }, `✓ #${o.number} ra sân`, (c) => setOn(c, o.id, null)) }
  const doMark = () => {
    if (st.mark.at && !armMark) { setArmMark(true); setTimeout(() => setArmMark(false), 3000); return }
    setArmMark(false)
    const n = shownClock()
    void call('cam_mark_start', { p_token: token, p_on: true }, st.mark.at ? '🏁 Đã đánh dấu lại' : '🏁 Đã đánh dấu bắt đầu trận', (c) => ({ ...c, mark: { at: new Date().toISOString(), clock: n } }))
  }
  const showBench = !!outP || on.length < 5

  return (
    <div className="rp cam">
      <div className="rp-head"><Logo size={22} /><span className="muted rp-title">Máy quay · {st.game.title}</span></div>
      <div className="rp-score">
        <span className="rp-tname">{st.game.home}</span><b className="home">{st.score.home}</b>
        <span className={`rp-clock ${running ? 'run' : ''}`}>{qLabel(st.game.period)}</span>
        <b className="away">{st.score.away}</b><span className="rp-tname">{st.game.away}</span>
      </div>

      <div className="cam-clock">
        {editing !== null ? (
          <div className="cam-edit">
            <input autoFocus inputMode="numeric" pattern="[0-9:]*" enterKeyHint="done" placeholder="7:32" value={editing}
              onChange={(e) => setEditing(e.target.value.replace(/[^0-9:]/g, '').slice(0, 5))}
              onKeyDown={(e) => { if (e.key === 'Enter') commitTime(); if (e.key === 'Escape') setEditing(null) }} />
            <button className="ok" onClick={commitTime}>OK</button>
            <button onClick={() => setEditing(null)}>Huỷ</button>
          </div>
        ) : (
          <button className={`cam-time ${running ? 'run' : ''}`} title="Chạm để nhập giờ" onClick={() => setEditing('')}>{mmss(now)}<small>chạm để sửa giờ</small></button>
        )}
        {editing === null && (
          <button className={`cam-go ${running ? 'stop' : ''}`} disabled={!running && now <= 0} onClick={() => { const n = shownClock(); clock(running ? 'stop' : 'start', 0, running ? '⏸ Đã dừng' : '▶ Đồng hồ chạy', (c) => withClock(c, { running: !running }, n)) }}>
            {running ? '⏸ DỪNG' : '▶ CHẠY'}
          </button>
        )}
      </div>
      {err && <div className="err">{err}</div>}

      <div className="cam-tools">
        <button className={`${st.mark.at ? 'done' : ''} ${armMark ? 'arm' : ''}`} onClick={doMark}>
          🏁 {armMark ? 'Bấm lần nữa' : st.mark.at ? `BĐ ${hms(st.mark.at)}` : 'Đánh dấu BĐ trận'}
        </button>
        <button className={panel === 'time' ? 'on' : ''} onClick={() => setPanel(panel === 'time' ? null : 'time')}>⏱ Chỉnh giờ</button>
        <button onClick={() => call('cam_undo', { p_token: token }, '↶ Đã hoàn tác')}>↶ Hoàn tác</button>
      </div>

      {panel === 'time' && (
        <div className="cam-panel">
          <div className="cam-adj">
            <button onClick={() => adj(-10)}>−10s</button>
            <button onClick={() => adj(-1)}>−1s</button>
            <button onClick={() => adj(1)}>+1s</button>
            <button onClick={() => adj(10)}>+10s</button>
            <button className={`reset ${armReset ? 'arm' : ''}`} onClick={resetClock}>{armReset ? 'Bấm lần nữa' : '↺ Reset giờ hiệp'}</button>
            <button disabled={st.game.period <= 1} onClick={() => per(-1)}>‹ Hiệp</button>
            <button onClick={() => per(1)}>Hiệp ›</button>
          </div>
          {st.mark.at && <button className="cam-link" onClick={() => call('cam_mark_start', { p_token: token, p_on: false }, 'Đã xoá mốc', (c) => ({ ...c, mark: { at: null, clock: null } }))}>Xoá mốc bắt đầu trận ({hms(st.mark.at)})</button>}
        </div>
      )}

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

      <div className="rp-sel">{me ? <>Đang chọn <b>#{me.number} {me.name}</b></> : 'Chạm một cầu thủ để +điểm'}</div>
      <div className={`cam-score ${me ? '' : 'idle'}`}>
        <button disabled={!me} onClick={() => score(1)}>+1</button>
        <button disabled={!me} onClick={() => score(2)}>+2</button>
        <button disabled={!me} onClick={() => score(3)}>+3</button>
      </div>

      {showBench && (
        <>
          {outP ? (
            <div className="cam-out">
              <span><b>#{outP.number} {outP.name}</b> ra sân. Chạm người dự bị để vào.</span>
              <button onClick={outOnly}>Chỉ cho ra</button>
              <button onClick={() => setOutId(null)}>Huỷ</button>
            </div>
          ) : <div className="sp-group-label">DỰ BỊ · chạm để vào sân (sân chưa đủ 5 người)</div>}
          <div className="rp-players cam-bench">
            {bench.map((p) => (
              <button key={p.id} className="rp-player bench ready" onClick={() => pickBench(p)}>
                <b>{p.number}</b><span>{p.name}</span>
              </button>
            ))}
            {bench.length === 0 && <div className="rp-empty muted">Không có dự bị.</div>}
          </div>
        </>
      )}
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
