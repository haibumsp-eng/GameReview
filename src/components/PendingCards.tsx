import { useState } from 'react'
import { useData, useUi, toast } from '../store'
import { byGameTime, mmss, onCourt } from '../lib/minutes'
import { periodLabel, STAT_LABEL } from '../lib/boxscore'
import { isThreeZone, zoneOf, ZONE_LABEL } from '../lib/analytics'
import { confirmDialog } from '../lib/dialog'
import { Court } from './Court'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'

const opp = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const isShot = (t: StatType) => t === '2PM' || t === '2PX' || t === '3PM' || t === '3PX'
const isMade = (t: StatType) => t === '2PM' || t === '3PM'

/** Thông tin người bấm stats bổ sung cho một pha đang chờ. */
interface Draft { loc?: { x: number; y: number }; fb?: boolean; ast?: string | null; blk?: string | null; rebs?: string[]; stl?: string; put?: 'made' | 'miss' | 'none' }

/**
 * Các pha đang chờ người bấm stats xác nhận (do bàn thư ký hoặc máy quay ghi): vị trí ném đúng loại 2 / 3 điểm,
 * kiến tạo, rebound (OR / DR, tip-in), block, mất bóng / steal. Hiện ở tab Record (cùng chỗ các câu hỏi kiến tạo, ném phạt)
 * và ở tab Biên bản.
 */
export function PendingCards({ canEdit }: { canEdit: boolean }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { gamePlayers, stats, lineups, addStat, updateStat, removeStat } = useData()
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const pend = byGameTime(stats.filter((e) => e.pending)).reverse()
  if (!game || !pend.length) return null
  const court = onCourt(lineups)
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || 'HOME' : game.awayName || 'AWAY')
  const onList = (s: TeamSide) => gamePlayers.filter((p) => p.side === s && court.has(p.id)).sort((a, b) => a.number - b.number)
  const label = (id: string | null) => { const p = id ? byId.get(id) : undefined; return p ? `#${p.number} ${p.name}` : 'Đội' }

  const D = (id: string) => draft[id] ?? {}
  const patch = (id: string, p: Draft) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }))
  const complete = (e: StatEvent) => {
    const d = D(e.id)
    if (e.type === '2PX' || e.type === '3PX' || e.type === 'FTX') return !!d.rebs?.length && (!orPlayer(e) || !!d.put)
    if (e.type === 'TOV') return d.stl !== undefined
    return true
  }
  const need = (e: StatEvent) => {
    const d = D(e.id), n: string[] = []
    if ((e.type === '2PX' || e.type === '3PX' || e.type === 'FTX') && !d.rebs?.length) n.push('chọn người bắt bóng bật bảng')
    if (orPlayer(e) && !d.put) n.push('người OREB có dứt điểm ngay không')
    if (e.type === 'TOV' && d.stl === undefined) n.push('chọn người cướp bóng hoặc “Không ai”')
    return n.join(' · ')
  }
  // Rebound của ném phạt (tranh bóng) chọn được nhiều người; ném rổ thường chỉ một người.
  // Người OREB (cùng đội ném) trong số người đã chọn: hỏi có dứt điểm ngay (tip-in / putback) không.
  const orPlayer = (e: StatEvent) => (D(e.id).rebs ?? []).map((id) => byId.get(id)).find((p) => p && p.side === e.side)
  const pickReb = (e: StatEvent, id: string) => {
    const cur = D(e.id).rebs ?? []
    if (e.type !== 'FTX') return patch(e.id, { rebs: [id] })
    patch(e.id, { rebs: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
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
      const put = orPlayer(e)
      if (put && d.put === 'made') addStat({ ...base, linkedId: null, side: put.side, gamePlayerId: put.id, type: '2PM', paint: true })
      if (put && d.put === 'miss') addStat({ ...base, linkedId: null, side: put.side, gamePlayerId: put.id, type: '2PX', paint: true, pending: true })
      for (const rid of d.rebs ?? []) {
        const r = byId.get(rid)
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
  const grid = (list: GamePlayer[], on: string | string[] | null | undefined, click: (p: GamePlayer) => void, dim?: (p: GamePlayer) => boolean) => (
    <div className="es-grid">
      {list.map((p) => (
        <button key={p.id} className={`es-p ${(Array.isArray(on) ? on.includes(p.id) : on === p.id) ? 'sel' : ''}`} disabled={!canEdit || dim?.(p)} onClick={() => click(p)}>
          <b>{p.number}</b><span>{p.name}</span>
        </button>
      ))}
    </div>
  )

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
              <div>{d.loc ? <><b>Vị trí:</b> {ZONE_LABEL[zoneOf(d.loc.x, d.loc.y)]}</> : <span className="muted">Vị trí: chưa chọn (tuỳ chọn)</span>}</div>
              <label className="es-chk"><input type="checkbox" checked={!!d.fb} onChange={(ev) => patch(e.id, { fb: ev.target.checked })} /> Fast break</label>
            </div>
          </div>
        )}
        {isMade(e.type) && (
          <div><div className="sp-group-label">Kiến tạo (tuỳ chọn)</div>
            {grid(onList(e.side).filter((p) => p.id !== e.gamePlayerId), d.ast, (p) => patch(e.id, { ast: d.ast === p.id ? null : p.id }))}</div>
        )}
        {miss && (
          <div><div className="sp-group-label">Ai bắt bóng bật bảng? (bắt buộc{e.type === 'FTX' ? '; tranh bóng có thể chọn cả OR và DR' : ''})</div>
            <div className="es-two">
              <div><div className="muted small-note">{name(e.side)} · rebound tấn công</div>{grid(onList(e.side), d.rebs, (p) => pickReb(e, p.id))}</div>
              <div><div className="muted small-note">{name(o)} · rebound phòng thủ</div>{grid(onList(o), d.rebs, (p) => pickReb(e, p.id))}</div>
            </div>
            {rebList.length === 0 && <div className="muted small-note">Chưa có ai trên sân. Máy quay cần đưa đội hình vào sân.</div>}
          </div>
        )}
        {miss && orPlayer(e) && (
          <div className="row wrap"><b>#{orPlayer(e)!.number} {orPlayer(e)!.name} (OREB) có dứt điểm ngay (tip-in / putback) không?</b>
            {([['made', 'Vào (+2)'], ['miss', 'Trượt'], ['none', 'Không dứt điểm']] as const).map(([k, l]) => <button key={k} className={`btn sm ${d.put === k ? 'primary' : ''}`} disabled={!canEdit} onClick={() => patch(e.id, { put: k })}>{l}</button>)}</div>
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

  return <div className="pend-list">{pend.map(card)}</div>
}
