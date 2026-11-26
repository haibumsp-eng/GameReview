import { useState } from 'react'
import { useData, useUi, toast } from '../store'
import { clockNow, onCourt } from '../lib/minutes'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'

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
const opp = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const PRIORITY: Record<FoulKind, number> = { PFT: 0, PFU: 0, PFD: 0, PFS: 1, PF: 1 }

/**
 * Hàng đợi ném phạt LƯU THEO TRẬN: lỗi còn nợ ném phạt có cờ ftOpen trong bảng thống kê (kèm số quả ftCount),
 * các quả đã ném nối với lỗi qua linkedId. Tải lại trang hay mở trên máy khác vẫn thấy đúng quả đang ném dở.
 * Quy tắc: lỗi kỹ thuật, không thể thể thao, truất quyền được ném TRƯỚC các lỗi thường; cùng nhóm thì theo thứ tự xảy ra.
 * Khung nằm ngay trên sân (cùng chỗ các câu hỏi rebound, kiến tạo), không bật cửa sổ riêng.
 */
export function FtQueue({ canEdit }: { canEdit: boolean }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const stats = useData((s) => s.stats)
  const updateStat = useData((s) => s.updateStat)
  const items = stats.filter((e) => e.ftOpen && FOUL_KINDS.includes(e.type)).sort((a, b) => a.createdAt - b.createdAt)
  if (!game || !items.length) return null
  const kind = (e: StatEvent) => e.type as FoulKind
  const active = [...items].sort((a, b) => PRIORITY[kind(a)] - PRIORITY[kind(b)] || items.indexOf(a) - items.indexOf(b))[0]
  const waiting = items.filter((x) => x.id !== active.id)
  const nm = (s: TeamSide) => (s === 'home' ? game.homeName || 'HOME' : game.awayName || 'AWAY')
  const close = (id: string) => updateStat(id, { ftOpen: false })
  return (
    <div className="ft-queue">
      {waiting.length > 0 && (
        <div className="row wrap muted small-note">
          <b>Ném phạt đang chờ ({items.length} lỗi):</b>
          {waiting.map((w) => (
            <span key={w.id} className="es-tag">{FOUL_TITLE[kind(w)]} · {nm(w.side)} <button className="icon-btn" title="Bỏ ném phạt này" onClick={() => close(w.id)}>×</button></span>
          ))}
          {PRIORITY[kind(active)] === 0 && <span>Lỗi kỹ thuật / không thể thể thao / truất quyền được ném trước lỗi thường.</span>}
        </div>
      )}
      {/* Các lỗi chờ vẫn được giữ nguyên bước đang dở (ẩn), chỉ lỗi ưu tiên cao nhất hiện ra. */}
      {items.map((it) => (
        <div key={it.id} hidden={it.id !== active.id}>
          <FtFlow foul={it} canEdit={canEdit} onClose={() => close(it.id)} />
        </div>
      ))}
    </div>
  )
}

interface Local { put?: 'made' | 'miss' | 'none'; and1: 0 | 2 | 3; shooter: string | null; count: number; sub: 'miss' | 'reb' | null; picks: string[] }

/**
 * Bảng ném phạt sau một lỗi: ai bị phạm lỗi và ném, bị phạm lỗi lúc đang ghi điểm (and-one) hay không,
 * từng quả vào / trượt, quả cuối trượt thì air ball hay chạm vành, và ai rebound (có thể cả OR lẫn DR).
 * Tiến độ (người ném, số quả, quả đã ném) lấy từ dữ liệu trận nên không mất khi tải lại.
 */
function FtFlow({ foul, canEdit, onClose }: { foul: StatEvent; canEdit: boolean; onClose: () => void }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { gamePlayers, lineups, stats, addStat, updateStat } = useData()
  const kind = foul.type as FoulKind
  const [loc, setLoc] = useState<Local>({ and1: 0, shooter: null, count: FT_RULE[kind].count, sub: null, picks: [] })
  if (!game) return null
  const rule = FT_RULE[kind], o = opp(foul.side)
  const court = onCourt(lineups)
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || 'HOME' : game.awayName || 'AWAY')
  const onList = (s: TeamSide) => gamePlayers.filter((p) => p.side === s && court.has(p.id)).sort((a, b) => a.number - b.number)
  // Tiến độ lấy từ dữ liệu: người ném = người bị phạm lỗi đã lưu; số quả đã ném = các quả phạt nối với lỗi này.
  const started = !!foul.drawnBy
  const shooterGp = byId.get(foul.drawnBy ?? loc.shooter ?? '')
  const count = foul.ftCount ?? loc.count
  const done = stats.filter((e) => e.linkedId === foul.id && (e.type === 'FTM' || e.type === 'FTX')).length
  const i = done + 1
  const stage: 'setup' | 'shots' | 'miss' | 'reb' = !started ? 'setup' : loc.sub ?? 'shots'
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
  const startFt = () => {
    if (!loc.shooter) return
    const n = loc.and1 ? 1 : loc.count
    updateStat(foul.id, { drawnBy: loc.shooter, ftCount: n })
    // Bị phạm lỗi lúc đang ghi điểm (and-one): ghi luôn cú ném vào (chờ bấm stats bổ sung vị trí), sau đó 1 quả phạt.
    const g = byId.get(loc.shooter)
    if (loc.and1 && g) {
      rec(loc.and1 === 2 ? '2PM' : '3PM', g, { pending: true })
      toast(`#${g.number} ${g.name} · ghi ${loc.and1} điểm và bị phạm lỗi: 1 quả phạt`)
    }
  }
  const ftShot = (made: boolean) => {
    if (!shooterGp) return
    const last = i >= count
    if (made || !last) { rec(made ? 'FTM' : 'FTX', shooterGp, { linkedId: foul.id }); return last ? onClose() : undefined }
    if (!rule.live) { rec('FTX', shooterGp, { linkedId: foul.id }); toast(rule.note); return onClose() }
    setLoc({ ...loc, sub: 'miss' })
  }
  const ftAir = () => { if (!shooterGp) return; rec('FTX', shooterGp, { linkedId: foul.id }); toast('Air ball: bóng thuộc quyền kiểm soát của đội phòng thủ'); onClose() }
  const ftRebound = (later: boolean) => {
    if (!shooterGp) return
    const fx = rec('FTX', shooterGp, { pending: later, linkedId: foul.id })
    if (!later) {
      for (const id of loc.picks) {
        const r = byId.get(id)
        if (r) rec(r.side === shooterGp.side ? 'OREB' : 'DREB', r, { linkedId: fx })
      }
      // Người OREB dứt điểm ngay (tip-in / putback): vào thì ghi 2 điểm trong paint, trượt thì chờ bấm stats chọn rebound tiếp.
      if (putter && loc.put === 'made') rec('2PM', putter, { paint: true })
      if (putter && loc.put === 'miss') rec('2PX', putter, { paint: true, pending: true })
    }
    onClose()
  }
  const putter = loc.picks.map((id) => byId.get(id)).find((p) => p && shooterGp && p.side === shooterGp.side)
  const togglePick = (p: GamePlayer) => setLoc({ ...loc, picks: loc.picks.includes(p.id) ? loc.picks.filter((x) => x !== p.id) : [...loc.picks, p.id] })

  return (
    <div className="es-card">
      <div className="es-ttl">{FOUL_TITLE[kind]} · {name(foul.side)} phạm lỗi, <span className={o === 'home' ? 'home' : 'away'}>{name(o)}</span> ném phạt</div>
      <div className="muted small-note">{rule.note}</div>
      {stage === 'setup' && (
        <>
          {rule.ask && (
            <>
              <div className="row wrap"><b>Cú ném của người bị phạm lỗi:</b>
                <button className={`btn ${loc.and1 === 0 ? 'primary' : ''}`} onClick={() => setLoc({ ...loc, and1: 0, count: Math.max(2, loc.count) })}>Không vào</button>
                <button className={`btn ${loc.and1 === 2 ? 'primary' : ''}`} onClick={() => setLoc({ ...loc, and1: 2, count: 1 })}>Vào 2 điểm (+1 phạt)</button>
                <button className={`btn ${loc.and1 === 3 ? 'primary' : ''}`} onClick={() => setLoc({ ...loc, and1: 3, count: 1 })}>Vào 3 điểm (+1 phạt)</button></div>
              {loc.and1 === 0
                ? <div className="row"><b>Số quả phạt:</b>{[2, 3].map((n) => <button key={n} className={`btn ${loc.count === n ? 'primary' : ''}`} onClick={() => setLoc({ ...loc, count: n })}>{n}</button>)}</div>
                : <div><b>Số quả phạt:</b> 1 (bàn thắng được tính, kèm 1 quả phạt)</div>}
            </>
          )}
          {!rule.ask && <div><b>Số quả phạt:</b> {rule.count}</div>}
          <div className="sp-group-label">Ai bị phạm lỗi và ném phạt? (bắt buộc)</div>
          {grid(onList(o), loc.shooter, (p) => setLoc({ ...loc, shooter: p.id }))}
          {onList(o).length === 0 && <div className="muted small-note">Chưa có ai của {name(o)} trên sân. Đưa đội hình vào sân trước (Thay người).</div>}
          <div className="row"><button className="btn primary" disabled={!canEdit || !loc.shooter} onClick={startFt}>Bắt đầu ném phạt</button>
            <button className="btn ghost" onClick={onClose}>Không có ném phạt</button></div>
        </>
      )}
      {stage === 'shots' && (
        i > count ? (
          <div className="row"><span>Đã ném đủ {count} quả.</span><button className="btn primary" onClick={onClose}>Xong</button></div>
        ) : (
          <>
            <div className="es-ttl">Quả {i}/{count} · <span className={o === 'home' ? 'home' : 'away'}>#{shooterGp?.number} {shooterGp?.name}</span></div>
            <div className="row"><button className="btn primary es-big" disabled={!canEdit} onClick={() => ftShot(true)}>Vào</button><button className="btn es-big" disabled={!canEdit} onClick={() => ftShot(false)}>Trượt</button>
              <button className="btn ghost" title="Bỏ phần ném phạt còn lại" onClick={onClose}>Bỏ phần còn lại</button></div>
            {i === count && !rule.live && <div className="muted small-note">Quả cuối trượt: không có rebound.</div>}
          </>
        )
      )}
      {stage === 'miss' && (
        <>
          <div className="es-ttl">Quả phạt cuối trượt: bóng chạm vành hay air ball?</div>
          <div className="row"><button className="btn primary" disabled={!canEdit} onClick={() => setLoc({ ...loc, sub: 'reb', picks: [] })}>Chạm vành (tranh bóng)</button>
            <button className="btn" disabled={!canEdit} onClick={ftAir}>Air ball: bóng của đội phòng thủ</button></div>
        </>
      )}
      {stage === 'reb' && (
        <>
          <div className="sp-group-label">Ai bắt bóng bật bảng? Chọn một hoặc nhiều người (có thể cả OR và DR)</div>
          <div className="es-two">
            <div><div className="muted small-note">{name(o)} · rebound tấn công (OR)</div>{grid(onList(o), loc.picks, togglePick)}</div>
            <div><div className="muted small-note">{name(foul.side)} · rebound phòng thủ (DR)</div>{grid(onList(foul.side), loc.picks, togglePick)}</div>
          </div>
          {putter && (
            <div className="row wrap"><b>#{putter.number} {putter.name} (OREB) có dứt điểm ngay (tip-in / putback) không?</b>
              {([['made', 'Vào (+2)'], ['miss', 'Trượt'], ['none', 'Không dứt điểm']] as const).map(([k, l]) => <button key={k} className={`btn ${loc.put === k ? 'primary' : ''}`} onClick={() => setLoc({ ...loc, put: k })}>{l}</button>)}</div>
          )}
          <div className="row"><button className="btn primary" disabled={!canEdit || !loc.picks.length || (!!putter && !loc.put)} onClick={() => ftRebound(false)}>Lưu rebound</button>
            <button className="btn" disabled={!canEdit} onClick={() => ftRebound(true)}>Để người bấm stats chọn sau</button></div>
        </>
      )}
    </div>
  )
}
