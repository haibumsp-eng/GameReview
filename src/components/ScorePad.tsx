import { useState } from 'react'
import { Logo } from './Logo'
import { mmss, qLabel, sbAct, useSbState } from '../scoreboard/api'

/**
 * Bảng điều khiển tỉ số + đồng hồ (điện thoại hoặc nhúng trong máy tính). Không đăng nhập, dùng mã điều khiển.
 * Chỉ gồm: điểm 2 đội, đồng hồ, hiệp. Hoàn toàn tách khỏi trận và stats.
 */
export function ScorePad({ token, embedded }: { token: string; embedded?: boolean }) {
  const { st, setSt, err, reload, clock } = useSbState(token, 1500)
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1800) }
  const act = async (action: string, arg?: number | null, side?: 'home' | 'away') => {
    navigator.vibrate?.(20)
    const r = await sbAct(token, action, arg, side)
    if (r !== 'ok') flash(r)
    await reload()
  }
  const score = (side: 'home' | 'away', d: number) => {
    // Hiện ngay trên màn hình rồi mới xác nhận với máy chủ.
    setSt((s) => (s ? { ...s, score: { ...s.score, [side]: Math.max(0, s.score[side] + d) } } : s))
    void act('score', d, side)
  }
  const toggle = () => {
    if (!st) return
    setSt({ ...st, running: !st.running, clock })
    void act(st.running ? 'stop' : 'start')
  }
  const saveEdit = () => {
    const m = edit?.trim().match(/^(\d{1,2}):(\d{2})$/) ?? edit?.trim().match(/^(\d{1,2})$/)
    if (!m) return flash('Nhập dạng 7:32')
    const sec = m[2] !== undefined ? +m[1] * 60 + +m[2] : +m[1] * 60
    setEdit(null); void act('set_clock', sec)
  }
  const nudge = (d: number) => void act('set_clock', Math.max(0, Math.round(clock + d)))

  if (!st) return <div className="pad pad-center">{err ? <div className="err">{err}</div> : <div className="muted">Đang tải…</div>}</div>
  if (!st.canControl) return <div className="pad pad-center"><div className="err">Đây là mã chỉ xem. Hãy dùng mã điều khiển.</div></div>

  const teamCol = (side: 'home' | 'away') => (
    <div className={`pad-team ${side}`}>
      <span className="pad-tname">{side === 'home' ? st.home : st.away}</span>
      <b className="pad-num">{st.score[side]}</b>
      <div className="pad-pts">
        {[1, 2, 3].map((n) => <button key={n} onClick={() => score(side, n)}>+{n}</button>)}
      </div>
      <button className="pad-minus" onClick={() => score(side, -1)}>−1</button>
    </div>
  )

  return (
    <div className={`pad ${embedded ? 'embedded' : ''}`} style={{ ['--home' as string]: st.homeColor, ['--away' as string]: st.awayColor }}>
      {!embedded && <div className="pad-head"><Logo size={22} /><span className="muted pad-title">{st.name}</span></div>}
      <div className="pad-teams">{teamCol('home')}{teamCol('away')}</div>
      <div className="pad-clockbox">
        <div className="pad-period">
          <button disabled={st.period <= 1} onClick={() => void act('period', st.period - 1)}>‹</button>
          <b>{qLabel(st.period)}</b>
          <button disabled={st.period >= 12} onClick={() => void act('period', st.period + 1)}>›</button>
        </div>
        {edit === null ? (
          <button className={`pad-time ${st.running ? 'run' : ''}`} onClick={() => setEdit(mmss(clock))}>{mmss(clock)}</button>
        ) : (
          <div className="pad-edit">
            <input autoFocus inputMode="numeric" value={edit} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEdit(null) }} />
            <button className="btn primary" onClick={saveEdit}>OK</button>
            <button className="btn" onClick={() => setEdit(null)}>Huỷ</button>
          </div>
        )}
        <button className={`pad-go ${st.running ? 'stop' : ''}`} onClick={toggle}>{st.running ? '❚❚ DỪNG GIỜ' : '▶ CHẠY GIỜ'}</button>
        <div className="pad-nudge">
          <button onClick={() => nudge(-10)}>−10s</button><button onClick={() => nudge(-1)}>−1s</button>
          <button onClick={() => nudge(1)}>+1s</button><button onClick={() => nudge(10)}>+10s</button>
        </div>
      </div>
      <div className="pad-foot">
        {msg ? <span className="pad-msg">{msg}</span> : err ? <span className="err">{err}</span> : <span className="muted">{st.league || ' '}</span>}
        {confirmReset
          ? <button className="pad-reset sure" onClick={() => { setConfirmReset(false); void act('reset') }}>Bấm lần nữa để đặt lại</button>
          : <button className="pad-reset" onClick={() => { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 3000) }}>Đặt lại bảng</button>}
      </div>
    </div>
  )
}
