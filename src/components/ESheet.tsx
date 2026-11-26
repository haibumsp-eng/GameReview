import { useEffect, useState } from 'react'
import { useData, useUi, toast } from '../store'
import { byGameTime, clockNow, mmss, onCourt, periodLength } from '../lib/minutes'
import { lineOf, periodLabel, STAT_LABEL } from '../lib/boxscore'
import { BONUS_AT, isThreeZone, teamFouls, timeouts, zoneOf, ZONE_LABEL } from '../lib/analytics'
import { confirmDialog } from '../lib/dialog'
import { Court } from './Court'
import { FtQueue, type FoulKind } from './FtFlow'
import { PendingCards } from './PendingCards'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'

const opp = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const isShot = (t: StatType) => t === '2PM' || t === '2PX' || t === '3PM' || t === '3PX'
const isMade = (t: StatType) => t === '2PM' || t === '3PM'
const shotName = (t: StatType) => (t.startsWith('2') ? '2 điểm' : '3 điểm')

/**
 * Biên bản điện tử: ba người cùng làm một trận.
 * 1. Bàn thư ký: ghi điểm, lỗi, time-out, chuỗi ném phạt.
 * 2. Máy quay: đồng hồ và thay người (đội hình trên sân hiện cho bàn thư ký).
 * 3. Bấm stats: kiểm tra điểm, chọn vị trí ném (đúng loại 2/3 điểm), rebound, kiến tạo, block, mất bóng / steal.
 * Mọi thứ ghi vào cùng bảng thống kê của trận nên box score và phân tích tự cập nhật.
 */
export function ESheet({ canEdit }: { canEdit: boolean }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { gamePlayers, stats, lineups, addStat, updateStat, removeStat, addLineup, setClock } = useData()
  const [role, setRole] = useState<1 | 2 | 3>(1)
  const [side, setSide] = useState<TeamSide>('home')
  const [sel, setSel] = useState<string | null>(null)
  const [subOut, setSubOut] = useState<string | null>(null)
  const [, tick] = useState(0)

  const running = !!game?.clockRunning
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(iv)
  }, [running])
  useEffect(() => { setSel(null); setSubOut(null) }, [gameId])

  if (!game) return null
  const len = game.periodLen ?? 600
  const period = game.clockPeriod ?? 1
  const remaining = clockNow(game)
  const court = onCourt(lineups)
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || 'HOME' : game.awayName || 'AWAY')
  const roster = (s: TeamSide) => gamePlayers.filter((p) => p.side === s).sort((a, b) => a.number - b.number)
  const onList = (s: TeamSide) => roster(s).filter((p) => court.has(p.id))
  const score = (s: TeamSide) => lineOf(stats.filter((e) => e.side === s)).pts
  const label = (id: string | null) => { const p = id ? byId.get(id) : undefined; return p ? `#${p.number} ${p.name}` : 'Đội' }
  const pend = byGameTime(stats.filter((e) => e.pending)).reverse()
  const me = sel ? byId.get(sel) : undefined

  const rec = (type: StatType, gp: GamePlayer, extra: Partial<StatEvent> = {}) =>
    addStat({ gameId: game.id, side: gp.side, gamePlayerId: gp.id, type, period, videoId: null, videoT: null, clockS: clockNow(game), ...extra })

  /* ---------- 1. Bàn thư ký ---------- */
  const shot = (type: '2PM' | '3PM') => { if (!me) return; rec(type, me, { pending: true }); toast(`#${me.number} ${me.name} · ${type === '2PM' ? '+2' : '+3'} (chờ bấm stats)`); setSel(null) }
  // Lỗi: ghi ngay lỗi. Lỗi dẫn tới ném phạt thì mở bảng ném phạt (hỏi ai ném, từng quả vào hay trượt, ai rebound).
  const foul = (type: FoulKind) => {
    if (!me) return
    const n = teamFouls(stats, me.side, period) + 1 // lỗi đồng đội của hiệp, tính cả lỗi này
    const bonus = n > BONUS_AT
    const needFt = type !== 'PF' || bonus
    rec(type, me, needFt ? { ftOpen: true } : {}) // lỗi dẫn tới ném phạt: vào hàng đợi ném phạt của trận
    toast(`#${me.number} ${me.name} · ${STAT_LABEL[type]} (lỗi đồng đội ${n})`)
    setSel(null)
    if (type === 'PF' && !bonus) return toast(`Lỗi cá nhân #${me.number}: bóng cho ${name(opp(me.side))} (chưa bonus, ${name(me.side)} có ${n} lỗi)`)
  }
  const timeout = (s: TeamSide) => {
    const t = timeouts(stats, s, period)
    if (t.used >= t.max) toast(`Lưu ý: ${name(s)} đã dùng hết ${t.max} timeout của giai đoạn này`)
    if (running) setClock(game.id, { clockRunning: false, clockRemaining: clockNow(game), clockStartedAt: null })
    addStat({ gameId: game.id, side: s, gamePlayerId: null, type: 'TMO', period, videoId: null, videoT: null, clockS: clockNow(game) })
    toast(`${periodLabel(period)} ${mmss(clockNow(game))} · Timeout ${name(s)} (đồng hồ đã dừng)`)
  }

  /* ---------- 2. Máy quay ---------- */
  const toggleClock = () => {
    if (running) setClock(game.id, { clockRunning: false, clockRemaining: clockNow(game), clockStartedAt: null })
    else if (remaining > 0) setClock(game.id, { clockRunning: true, clockRemaining: remaining, clockStartedAt: Date.now() })
  }
  const bump = (d: number) => setClock(game.id, { clockRemaining: Math.min(periodLength(period, len), Math.max(0, remaining + d)), clockStartedAt: running ? Date.now() : null })
  const goPeriod = (p: number) => { if (p >= 1) setClock(game.id, { clockPeriod: p, clockRunning: false, clockRemaining: periodLength(p, len), clockStartedAt: null }) }
  const subIn = (p: GamePlayer) => {
    if (subOut) {
      const o = byId.get(subOut)
      if (o && o.side === p.side) {
        addLineup({ gameId: game.id, side: o.side, gamePlayerId: o.id, kind: 'out', period, clockS: remaining })
        addLineup({ gameId: game.id, side: p.side, gamePlayerId: p.id, kind: 'in', period, clockS: remaining })
        toast(`${periodLabel(period)} ${mmss(remaining)} · #${o.number} ra, #${p.number} vào`)
        return setSubOut(null)
      }
    }
    if (onList(p.side).length >= 5) return toast('Đã đủ 5 người trên sân: bấm người ra sân trước')
    addLineup({ gameId: game.id, side: p.side, gamePlayerId: p.id, kind: 'in', period, clockS: remaining })
  }

  /* ---------- 3. Bấm stats: xem PendingCards ---------- */
  const addExtra = (type: StatType) => { if (!me) return; rec(type, me, { pending: true }); toast(`#${me.number} ${me.name} · ${STAT_LABEL[type]} (cần bổ sung)`); setSel(null) }

  /* ---------- Giao diện ---------- */
  const grid = (list: GamePlayer[], on: string | string[] | null | undefined, click: (p: GamePlayer) => void) => (
    <div className="es-grid">
      {list.map((p) => (
        <button key={p.id} className={`es-p ${(Array.isArray(on) ? on.includes(p.id) : on === p.id) ? 'sel' : ''}`} disabled={!canEdit} onClick={() => click(p)}>
          <b>{p.number}</b><span>{p.name}</span>
        </button>
      ))}
    </div>
  )
  const sideTabs = (
    <div className="seg-toggle es-side">
      {(['home', 'away'] as const).map((s) => <button key={s} className={`${side === s ? 'on' : ''}`} onClick={() => { setSide(s); setSel(null); setSubOut(null) }}>{name(s)}</button>)}
    </div>
  )
  const teamLine = (s: TeamSide) => { const t = timeouts(stats, s, period); return `Lỗi đội ${teamFouls(stats, s, period)} · TO ${t.used}/${t.max}` }

  const recent = [...stats].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
  return (
    <div className="es">
      <div className="es-board card">
        <div className="home"><b>{name('home')}</b><span className="es-sc">{score('home')}</span><small>{teamLine('home')}</small></div>
        <div className="es-mid"><span className="es-clk">{mmss(remaining)}</span><small>{periodLabel(period)}{running ? ' · đang chạy' : ' · dừng'}</small></div>
        <div className="away"><b>{name('away')}</b><span className="es-sc">{score('away')}</span><small>{teamLine('away')}</small></div>
      </div>
      <div className="es-roles">
        {([[1, 'Bàn thư ký', 'Ghi điểm, lỗi, time-out'], [2, 'Máy quay', 'Đồng hồ và thay người'], [3, 'Bấm stats', 'Vị trí, rebound, kiến tạo, mất bóng']] as const).map(([k, a, b]) => (
          <button key={k} className={role === k ? 'on' : ''} onClick={() => { setRole(k); setSel(null); setSubOut(null) }}>
            {k} · {a}{k === 3 && pend.length > 0 && <i className="es-badge">{pend.length}</i>}<small>{b}</small>
          </button>
        ))}
      </div>

      <FtQueue canEdit={canEdit} />
      <div className="card stack es-panel">
        {role === 1 && (
          <>
            {sideTabs}
            {onList(side).length === 0 && <div className="muted">Chưa có ai trên sân. Máy quay đưa đội hình vào sân ở vai trò 2 (hoặc dùng “Thay người” ở tab Record).</div>}
            {grid(onList(side), sel, (p) => setSel(sel === p.id ? null : p.id))}
            <div className="es-acts">
              <button className="btn primary es-big" disabled={!canEdit || !me} onClick={() => shot('2PM')}>+2</button>
              <button className="btn primary es-big" disabled={!canEdit || !me} onClick={() => shot('3PM')}>+3</button>
            </div>
            <div className="es-acts">
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PF')}>Lỗi cá nhân</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFS')}>Lỗi khi ném rổ</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFT')}>Lỗi kỹ thuật</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFU')}>Không thể thể thao</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFD')}>Truất quyền</button>
              <button className="btn" disabled={!canEdit} onClick={() => timeout(side)}>Time-out {name(side)}</button>
            </div>
            <div className="muted small-note">Chỉ hiện người đang trên sân. Lỗi dẫn tới ném phạt (lỗi khi ném rổ, kỹ thuật, không thể thể thao, truất quyền, hoặc lỗi cá nhân khi đối phương đã bonus) sẽ mở bảng ném phạt. Pha ghi điểm chờ vai trò 3 bổ sung vị trí, kiến tạo.</div>
          </>
        )}

        {role === 2 && (
          <>
            <div className="row wrap">
              <button className="btn primary" disabled={!canEdit} onClick={toggleClock}>{running ? '⏸ Dừng đồng hồ' : '▶ Chạy đồng hồ'}</button>
              <button className="btn" disabled={!canEdit} onClick={() => bump(-1)}>−1s</button>
              <button className="btn" disabled={!canEdit} onClick={() => bump(1)}>+1s</button>
              <button className="btn" disabled={!canEdit} onClick={() => bump(10)}>+10s</button>
              <button className="btn" disabled={!canEdit || period <= 1} onClick={() => goPeriod(period - 1)}>Hiệp trước</button>
              <button className="btn" disabled={!canEdit} onClick={() => goPeriod(period + 1)}>Hiệp kế tiếp</button>
            </div>
            {sideTabs}
            <div className="sp-group-label">Trên sân {onList(side).length}/5 · bấm người ra sân, rồi bấm người vào</div>
            {grid(onList(side), subOut, (p) => setSubOut(subOut === p.id ? null : p.id))}
            <div className="sp-group-label">Dự bị</div>
            {grid(roster(side).filter((p) => !court.has(p.id)), null, subIn)}
          </>
        )}

        {role === 3 && (
          <>
            {pend.length === 0 && <div className="muted">Không có pha nào chờ. Khi bàn thư ký ghi điểm hoặc bạn thêm pha bên dưới, pha hiện ở đây.</div>}
            <PendingCards canEdit={canEdit} />
            <div className="es-card quiet">
              <div className="es-ttl">Thêm pha bàn thư ký không ghi (ném trượt, mất bóng)</div>
              {sideTabs}
              {grid(onList(side), sel, (p) => setSel(sel === p.id ? null : p.id))}
              <div className="row wrap">
                <button className="btn" disabled={!canEdit || !me} onClick={() => addExtra('2PX')}>Trượt 2 điểm</button>
                <button className="btn" disabled={!canEdit || !me} onClick={() => addExtra('3PX')}>Trượt 3 điểm</button>
                <button className="btn" disabled={!canEdit || !me} onClick={() => addExtra('TOV')}>Mất bóng</button>
              </div>
              <div className="muted small-note">Rebound và mất bóng luôn gắn với một cầu thủ.</div>
            </div>
          </>
        )}
      </div>

      <div className="card es-feed">
        <div className="sp-group-label">Dòng sự kiện mới nhất</div>
        {recent.length === 0 && <div className="muted">Chưa có sự kiện.</div>}
        {recent.map((e) => (
          <div key={e.id} className="es-ev">
            <span className="muted">{periodLabel(e.period)} {e.clockS != null ? mmss(e.clockS) : ''}</span>
            <span className={e.side === 'home' ? 'home' : 'away'}>●</span>
            <span className="grow">{label(e.gamePlayerId)} · {STAT_LABEL[e.type]}{e.type === 'TMO' ? ` ${name(e.side)}` : ''}</span>
            {e.pending && <span className="es-tag">chờ stats</span>}
          </div>
        ))}
        <div className="muted small-note">{shotName('2PM')} / {shotName('3PM')}: dùng cùng dữ liệu với Record, Box score và Phân tích.</div>
      </div>
    </div>
  )
}
