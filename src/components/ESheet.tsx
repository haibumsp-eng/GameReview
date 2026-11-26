import { useEffect, useState } from 'react'
import { useData, useUi, toast } from '../store'
import { byGameTime, clockNow, mmss, onCourt, periodLength } from '../lib/minutes'
import { lineOf, periodLabel, STAT_LABEL } from '../lib/boxscore'
import { isThreeZone, teamFouls, timeouts, zoneOf, ZONE_LABEL } from '../lib/analytics'
import { confirmDialog } from '../lib/dialog'
import { Court } from './Court'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'

const opp = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const isShot = (t: StatType) => t === '2PM' || t === '2PX' || t === '3PM' || t === '3PX'
const isMade = (t: StatType) => t === '2PM' || t === '3PM'
const shotName = (t: StatType) => (t.startsWith('2') ? '2 điểm' : '3 điểm')

/** Thông tin người bấm stats bổ sung cho một pha đang chờ. */
interface Draft { loc?: { x: number; y: number }; fb?: boolean; ast?: string | null; blk?: string | null; reb?: string; stl?: string }

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
  const [ft, setFt] = useState<{ gp: string; i: number; total: number } | null>(null)
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [, tick] = useState(0)

  const running = !!game?.clockRunning
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(iv)
  }, [running])
  useEffect(() => { setSel(null); setSubOut(null); setFt(null) }, [gameId])

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
  const foul = (type: StatType) => { if (!me) return; rec(type, me); toast(`#${me.number} ${me.name} · ${STAT_LABEL[type]}`); setSel(null) }
  const ftStart = (n: number) => { if (me) { setFt({ gp: me.id, i: 1, total: n }); setSel(null) } }
  const ftShot = (made: boolean) => {
    if (!ft) return
    const gp = byId.get(ft.gp)
    if (!gp) return setFt(null)
    const last = ft.i === ft.total
    // Quả vào, hoặc trượt khi còn quả sau: không cần bổ sung. Trượt quả cuối: chờ chọn người bắt bóng bật bảng.
    rec(made ? 'FTM' : 'FTX', gp, { pending: !made && last })
    setFt(last ? null : { ...ft, i: ft.i + 1 })
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

  /* ---------- 3. Bấm stats ---------- */
  const D = (id: string) => draft[id] ?? {}
  const patch = (id: string, p: Draft) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }))
  const complete = (e: StatEvent) => {
    const d = D(e.id)
    if (isShot(e.type) && !d.loc) return false
    if (e.type === '2PX' || e.type === '3PX' || e.type === 'FTX') return !!d.reb
    if (e.type === 'TOV') return d.stl !== undefined
    return true
  }
  const need = (e: StatEvent) => {
    const d = D(e.id), n: string[] = []
    if (isShot(e.type) && !d.loc) n.push(`chọn vị trí ném ${e.type.startsWith('2') ? '2 điểm (trong vạch 3 điểm)' : '3 điểm (ngoài vạch 3 điểm)'}`)
    if ((e.type === '2PX' || e.type === '3PX' || e.type === 'FTX') && !d.reb) n.push('chọn người bắt bóng bật bảng')
    if (e.type === 'TOV' && d.stl === undefined) n.push('chọn người cướp bóng hoặc “Không ai”')
    return n.join(' · ')
  }
  const pickLoc = (e: StatEvent, x: number, y: number) => {
    const z = zoneOf(x, y), three = isThreeZone(z)
    if (e.type.startsWith('2') && three) return toast('Vị trí này nằm ngoài vạch 3 điểm: không thể là cú ném 2 điểm')
    if (e.type.startsWith('3') && !three) return toast('Vị trí này nằm trong vạch 3 điểm: không thể là cú ném 3 điểm')
    patch(e.id, { loc: { x, y } })
  }
  const save = (e: StatEvent) => {
    const d = D(e.id), shooter = e.gamePlayerId
    const base = { gameId: game.id, period: e.period, videoId: e.videoId, videoT: e.videoT, clockS: e.clockS ?? null, linkedId: e.id }
    const p: Parameters<typeof updateStat>[1] = { pending: false }
    if (isShot(e.type) && d.loc) Object.assign(p, { shotX: d.loc.x, shotY: d.loc.y, paint: e.type.startsWith('2') && zoneOf(d.loc.x, d.loc.y) === 'paint', fastBreak: !!d.fb })
    if (isMade(e.type) && d.ast) addStat({ ...base, side: e.side, gamePlayerId: d.ast, type: 'AST' })
    if (!isMade(e.type) && e.type !== 'TOV') {
      if (d.reb) {
        const r = byId.get(d.reb)
        if (r) addStat({ ...base, linkedId: null, side: r.side, gamePlayerId: r.id, type: r.side === e.side ? 'OREB' : 'DREB' })
      }
      if (d.blk && e.type !== 'FTX') addStat({ ...base, side: opp(e.side), gamePlayerId: d.blk, type: 'BLK' })
    }
    if (e.type === 'TOV') {
      if (d.stl && d.stl !== 'none') {
        const sid = addStat({ ...base, side: opp(e.side), gamePlayerId: d.stl, type: 'STL' })
        Object.assign(p, { tovKind: 'stolen', linkedId: sid })
      } else Object.assign(p, { tovKind: 'self', linkedId: null })
    }
    void shooter
    updateStat(e.id, p)
    setDraft((x) => { const n = { ...x }; delete n[e.id]; return n })
    toast(`Đã lưu: ${label(e.gamePlayerId)} · ${STAT_LABEL[e.type]}`)
  }
  const reject = async (e: StatEvent) => {
    if (!(await confirmDialog({ title: 'Huỷ pha này?', message: `${label(e.gamePlayerId)} · ${STAT_LABEL[e.type]} sẽ bị xoá khỏi trận (điểm và box score cập nhật lại).`, okText: 'Huỷ pha', danger: true }))) return
    removeStat(e.id)
  }
  const addExtra = (type: StatType) => { if (!me) return; rec(type, me, { pending: true }); toast(`#${me.number} ${me.name} · ${STAT_LABEL[type]} (cần bổ sung)`); setSel(null) }

  /* ---------- Giao diện ---------- */
  const grid = (list: GamePlayer[], on: string | null | undefined, click: (p: GamePlayer) => void, dim?: (p: GamePlayer) => boolean) => (
    <div className="es-grid">
      {list.map((p) => (
        <button key={p.id} className={`es-p ${on === p.id ? 'sel' : ''}`} disabled={!canEdit || dim?.(p)} onClick={() => click(p)}>
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

  const card = (e: StatEvent) => {
    const d = D(e.id), who = byId.get(e.gamePlayerId ?? '')
    const o = opp(e.side), miss = e.type === '2PX' || e.type === '3PX' || e.type === 'FTX'
    const rebList = [...onList(e.side), ...onList(o)]
    return (
      <div key={e.id} className="es-card">
        <div className="es-ttl"><b>{periodLabel(e.period)} {e.clockS != null ? mmss(e.clockS) : ''}</b> · <span className={e.side === 'home' ? 'home' : 'away'}>{who ? `#${who.number} ${who.name}` : name(e.side)}</span> · {STAT_LABEL[e.type]}</div>
        {isShot(e.type) && (
          <div className="es-body">
            <div className="es-court">
              <Court pick={d.loc ?? null} onPick={(x, y) => canEdit && pickLoc(e, x, y)} />
              <div className="muted small-note">{e.type.startsWith('2') ? 'Cú 2 điểm: chọn vị trí trong vạch 3 điểm.' : 'Cú 3 điểm: chọn vị trí ngoài vạch 3 điểm.'} Chạm sai khu thì không ghi được.</div>
            </div>
            <div className="stack">
              <div>{d.loc ? <><b>Vị trí:</b> {ZONE_LABEL[zoneOf(d.loc.x, d.loc.y)]}</> : <span className="muted">Chưa chọn vị trí</span>}</div>
              <label className="es-chk"><input type="checkbox" checked={!!d.fb} onChange={(ev) => patch(e.id, { fb: ev.target.checked })} /> Fast break</label>
            </div>
          </div>
        )}
        {isMade(e.type) && (
          <div><div className="sp-group-label">Kiến tạo (tuỳ chọn)</div>
            {grid(onList(e.side).filter((p) => p.id !== e.gamePlayerId), d.ast, (p) => patch(e.id, { ast: d.ast === p.id ? null : p.id }))}</div>
        )}
        {miss && (
          <div><div className="sp-group-label">Ai bắt bóng bật bảng? (bắt buộc)</div>
            <div className="es-two">
              <div><div className="muted small-note">{name(e.side)} · rebound tấn công</div>{grid(onList(e.side), d.reb, (p) => patch(e.id, { reb: p.id }))}</div>
              <div><div className="muted small-note">{name(o)} · rebound phòng thủ</div>{grid(onList(o), d.reb, (p) => patch(e.id, { reb: p.id }))}</div>
            </div>
            {rebList.length === 0 && <div className="muted small-note">Chưa có ai trên sân. Máy quay cần đưa đội hình vào sân.</div>}
          </div>
        )}
        {(e.type === '2PX' || e.type === '3PX') && (
          <div><div className="sp-group-label">Bị block bởi (tuỳ chọn)</div>
            {grid(onList(o), d.blk, (p) => patch(e.id, { blk: d.blk === p.id ? null : p.id }))}</div>
        )}
        {e.type === 'TOV' && (
          <div><div className="sp-group-label">Ai cướp bóng? (bắt buộc)</div>
            {grid(onList(o), d.stl, (p) => patch(e.id, { stl: p.id }))}
            <button className={`btn sm ${d.stl === 'none' ? 'primary' : ''}`} disabled={!canEdit} onClick={() => patch(e.id, { stl: 'none' })}>Không ai (tự mất bóng)</button></div>
        )}
        <div className="row">
          <button className="btn primary" disabled={!canEdit || !complete(e)} onClick={() => save(e)}>✓ Đúng, lưu</button>
          <button className="btn" disabled={!canEdit} onClick={() => void reject(e)}>✗ Sai, huỷ pha này</button>
          {!complete(e) && <span className="muted small-note">Còn thiếu: {need(e)}</span>}
        </div>
      </div>
    )
  }

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

      <div className="card stack es-panel">
        {role === 1 && (ft ? (() => {
          const gp = byId.get(ft.gp)
          return (
            <div className="es-card">
              <div className="es-ttl">Ném phạt: <span className={gp?.side === 'home' ? 'home' : 'away'}>#{gp?.number} {gp?.name}</span> · quả {ft.i}/{ft.total}</div>
              <div className="row"><button className="btn primary es-big" disabled={!canEdit} onClick={() => ftShot(true)}>Vào</button><button className="btn es-big" disabled={!canEdit} onClick={() => ftShot(false)}>Trượt</button><button className="btn ghost" onClick={() => setFt(null)}>Huỷ chuỗi</button></div>
              <div className="muted small-note">Bấm lần lượt từng quả. Quả trượt cuối chuỗi sẽ chờ người bấm stats chọn rebound.</div>
            </div>
          )
        })() : (
          <>
            {sideTabs}
            {onList(side).length === 0 && <div className="muted">Chưa có ai trên sân. Máy quay đưa đội hình vào sân ở vai trò 2 (hoặc dùng “Thay người” ở tab Record).</div>}
            {grid(onList(side), sel, (p) => setSel(sel === p.id ? null : p.id))}
            <div className="es-acts">
              <button className="btn primary es-big" disabled={!canEdit || !me} onClick={() => shot('2PM')}>+2</button>
              <button className="btn primary es-big" disabled={!canEdit || !me} onClick={() => shot('3PM')}>+3</button>
              {[1, 2, 3].map((n) => <button key={n} className="btn" disabled={!canEdit || !me} onClick={() => ftStart(n)}>Ném phạt {n} quả</button>)}
            </div>
            <div className="es-acts">
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PF')}>Lỗi cá nhân</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFT')}>Lỗi kỹ thuật</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFU')}>Không thể thể thao</button>
              <button className="btn" disabled={!canEdit || !me} onClick={() => foul('PFD')}>Truất quyền</button>
              <button className="btn" disabled={!canEdit} onClick={() => timeout(side)}>Time-out {name(side)}</button>
            </div>
            <div className="muted small-note">Chỉ hiện người đang trên sân. Mỗi pha ghi điểm tự chuyển sang vai trò 3 để bổ sung vị trí, kiến tạo, rebound.</div>
          </>
        ))}

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
            {pend.map(card)}
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
