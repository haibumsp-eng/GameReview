import { useState } from 'react'
import { useData, useUi, toast } from '../store'
import { clockNow, onCourt } from '../lib/minutes'
import type { GamePlayer, StatType, TeamSide } from '../types'

/** Lỗi dẫn tới ném phạt (FIBA): số quả, và quả cuối trượt có tranh bóng (rebound) hay không. */
export type FoulKind = 'PF' | 'PFS' | 'PFT' | 'PFU' | 'PFD'
export const FOUL_KINDS: StatType[] = ['PF', 'PFS', 'PFT', 'PFU', 'PFD']
export const FT_RULE: Record<FoulKind, { count: number; ask: boolean; live: boolean; note: string }> = {
  PF: { count: 2, ask: false, live: true, note: 'Đội đối phương đã vào bonus (từ lỗi đồng đội thứ 5 trong hiệp): ném phạt 2 quả.' },
  PFS: { count: 2, ask: true, live: true, note: 'Lỗi khi đang ném rổ: ném không vào thì 2 hoặc 3 quả phạt; ném vào thì tính điểm và 1 quả phạt (and-one).' },
  PFT: { count: 1, ask: false, live: false, note: 'Lỗi kỹ thuật: 1 quả phạt. Trượt thì bóng luân phiên (không có rebound).' },
  PFU: { count: 2, ask: false, live: false, note: 'Không thể thể thao: 2 quả phạt, sau đó bóng thuộc đội bị phạm lỗi (không có rebound).' },
  PFD: { count: 2, ask: false, live: false, note: 'Truất quyền: 2 quả phạt, sau đó bóng thuộc đội bị phạm lỗi (không có rebound).' },
}
export const FOUL_TITLE: Record<FoulKind, string> = { PF: 'Lỗi cá nhân (bonus)', PFS: 'Lỗi khi đang ném rổ (shooting foul)', PFT: 'Lỗi kỹ thuật', PFU: 'Lỗi không thể thể thao', PFD: 'Lỗi truất quyền' }
export interface FtStart { kind: FoulKind; foulId: string; foulerSide: TeamSide }

const opp = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
interface Flow { and1: 0 | 2 | 3; stage: 'setup' | 'shots' | 'miss' | 'reb'; shooter: string | null; count: number; i: number; picks: string[] }

/**
 * Bảng ném phạt sau một lỗi: ai bị phạm lỗi và ném, bị phạm lỗi lúc đang ghi điểm (and-one) hay không,
 * từng quả vào / trượt, quả cuối trượt thì air ball hay chạm vành, và ai rebound (có thể cả OR lẫn DR).
 * Dùng ở tab Biên bản và ở tab Record của Live Stats.
 */
export function FtFlow({ start, canEdit, onClose }: { start: FtStart; canEdit: boolean; onClose: () => void }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { gamePlayers, lineups, addStat, updateStat } = useData()
  const [flow, setFlow] = useState<Flow>({ and1: 0, stage: 'setup', shooter: null, count: FT_RULE[start.kind].count, i: 1, picks: [] })
  if (!game) return null
  const rule = FT_RULE[start.kind], o = opp(start.foulerSide)
  const court = onCourt(lineups)
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || 'HOME' : game.awayName || 'AWAY')
  const onList = (s: TeamSide) => gamePlayers.filter((p) => p.side === s && court.has(p.id)).sort((a, b) => a.number - b.number)
  const shooterGp = flow.shooter ? byId.get(flow.shooter) : undefined
  const rec = (type: StatType, gp: GamePlayer, extra: Partial<Parameters<typeof addStat>[0]> = {}) =>
    addStat({ gameId: game.id, side: gp.side, gamePlayerId: gp.id, type, period: game.clockPeriod ?? 1, videoId: null, videoT: null, clockS: clockNow(game), ...extra })

  const grid = (list: GamePlayer[], on: string | string[] | null, click: (p: GamePlayer) => void) => (
    <div className="es-grid">
      {list.map((p) => (
        <button key={p.id} className={`es-p ${(Array.isArray(on) ? on.includes(p.id) : on === p.id) ? 'sel' : ''}`} disabled={!canEdit} onClick={() => click(p)}>
          <b>{p.number}</b><span>{p.name}</span>
        </button>
      ))}
    </div>
  )
  const nextShot = (f: Flow) => (f.i >= f.count ? onClose() : setFlow({ ...f, i: f.i + 1, stage: 'shots' }))
  const startFt = () => {
    if (!flow.shooter) return
    updateStat(start.foulId, { drawnBy: flow.shooter })
    // Bị phạm lỗi lúc đang ghi điểm (and-one): ghi luôn cú ném vào (chờ bấm stats bổ sung vị trí), sau đó 1 quả phạt.
    if (flow.and1 && shooterGp) {
      rec(flow.and1 === 2 ? '2PM' : '3PM', shooterGp, { pending: true })
      toast(`#${shooterGp.number} ${shooterGp.name} · ghi ${flow.and1} điểm và bị phạm lỗi: 1 quả phạt`)
    }
    setFlow({ ...flow, count: flow.and1 ? 1 : flow.count, stage: 'shots' })
  }
  const ftShot = (made: boolean) => {
    if (!shooterGp) return
    const last = flow.i === flow.count
    if (made) { rec('FTM', shooterGp); return nextShot(flow) }
    if (!last) { rec('FTX', shooterGp); return nextShot(flow) }
    if (!rule.live) { rec('FTX', shooterGp); toast(rule.note); return onClose() }
    setFlow({ ...flow, stage: 'miss' })
  }
  const ftAir = () => { if (!shooterGp) return; rec('FTX', shooterGp); toast('Air ball: bóng thuộc quyền kiểm soát của đội phòng thủ'); onClose() }
  const ftRebound = (later: boolean) => {
    if (!shooterGp) return
    const fx = rec('FTX', shooterGp, { pending: later })
    if (!later) {
      for (const id of flow.picks) {
        const r = byId.get(id)
        if (r) rec(r.side === shooterGp.side ? 'OREB' : 'DREB', r, { linkedId: fx })
      }
    }
    onClose()
  }
  const togglePick = (p: GamePlayer) => setFlow({ ...flow, picks: flow.picks.includes(p.id) ? flow.picks.filter((x) => x !== p.id) : [...flow.picks, p.id] })

  return (
    <div className="es-card">
      <div className="es-ttl">{FOUL_TITLE[start.kind]} · {name(start.foulerSide)} phạm lỗi, <span className={o === 'home' ? 'home' : 'away'}>{name(o)}</span> ném phạt</div>
      <div className="muted small-note">{rule.note}</div>
      {flow.stage === 'setup' && (
        <>
          {rule.ask && (
            <>
              <div className="row wrap"><b>Cú ném của người bị phạm lỗi:</b>
                <button className={`btn ${flow.and1 === 0 ? 'primary' : ''}`} onClick={() => setFlow({ ...flow, and1: 0, count: Math.max(2, flow.count) })}>Không vào</button>
                <button className={`btn ${flow.and1 === 2 ? 'primary' : ''}`} onClick={() => setFlow({ ...flow, and1: 2, count: 1 })}>Vào 2 điểm (+1 phạt)</button>
                <button className={`btn ${flow.and1 === 3 ? 'primary' : ''}`} onClick={() => setFlow({ ...flow, and1: 3, count: 1 })}>Vào 3 điểm (+1 phạt)</button></div>
              {flow.and1 === 0
                ? <div className="row"><b>Số quả phạt:</b>{[2, 3].map((n) => <button key={n} className={`btn ${flow.count === n ? 'primary' : ''}`} onClick={() => setFlow({ ...flow, count: n })}>{n}</button>)}</div>
                : <div><b>Số quả phạt:</b> 1 (bàn thắng được tính, kèm 1 quả phạt)</div>}
            </>
          )}
          {!rule.ask && <div><b>Số quả phạt:</b> {rule.count}</div>}
          <div className="sp-group-label">Ai bị phạm lỗi và ném phạt? (bắt buộc)</div>
          {grid(onList(o), flow.shooter, (p) => setFlow({ ...flow, shooter: p.id }))}
          {onList(o).length === 0 && <div className="muted small-note">Chưa có ai của {name(o)} trên sân. Đưa đội hình vào sân trước (Thay người).</div>}
          <div className="row"><button className="btn primary" disabled={!canEdit || !flow.shooter} onClick={startFt}>Bắt đầu ném phạt</button>
            <button className="btn ghost" onClick={onClose}>Không có ném phạt</button></div>
        </>
      )}
      {flow.stage === 'shots' && (
        <>
          <div className="es-ttl">Quả {flow.i}/{flow.count} · <span className={o === 'home' ? 'home' : 'away'}>#{shooterGp?.number} {shooterGp?.name}</span></div>
          <div className="row"><button className="btn primary es-big" disabled={!canEdit} onClick={() => ftShot(true)}>Vào</button><button className="btn es-big" disabled={!canEdit} onClick={() => ftShot(false)}>Trượt</button></div>
          {flow.i === flow.count && !rule.live && <div className="muted small-note">Quả cuối trượt: không có rebound.</div>}
        </>
      )}
      {flow.stage === 'miss' && (
        <>
          <div className="es-ttl">Quả phạt cuối trượt: bóng chạm vành hay air ball?</div>
          <div className="row"><button className="btn primary" disabled={!canEdit} onClick={() => setFlow({ ...flow, stage: 'reb', picks: [] })}>Chạm vành (tranh bóng)</button>
            <button className="btn" disabled={!canEdit} onClick={ftAir}>Air ball: bóng của đội phòng thủ</button></div>
        </>
      )}
      {flow.stage === 'reb' && (
        <>
          <div className="sp-group-label">Ai bắt bóng bật bảng? Chọn một hoặc nhiều người (có thể cả OR và DR)</div>
          <div className="es-two">
            <div><div className="muted small-note">{name(o)} · rebound tấn công (OR)</div>{grid(onList(o), flow.picks, togglePick)}</div>
            <div><div className="muted small-note">{name(start.foulerSide)} · rebound phòng thủ (DR)</div>{grid(onList(start.foulerSide), flow.picks, togglePick)}</div>
          </div>
          <div className="row"><button className="btn primary" disabled={!canEdit || !flow.picks.length} onClick={() => ftRebound(false)}>Lưu rebound</button>
            <button className="btn" disabled={!canEdit} onClick={() => ftRebound(true)}>Để người bấm stats chọn sau</button></div>
        </>
      )}
    </div>
  )
}
