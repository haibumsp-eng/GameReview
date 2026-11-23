import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, toast } from '../store'
import { confirmDialog } from '../lib/dialog'

interface Row { key: string; playerId: string | null; gpId: string | null; name: string; base: number | null; on: boolean; num: string }

/**
 * Danh sách trận của đội nhà: ai ra sân trận này và mặc số áo nào.
 * Dùng chung cho Mổ băng (số áo hiện trên tình huống, bộ lọc, khoanh cầu thủ) và Live Stats (đội nhà).
 */
export function GameRosterModal({ onClose }: { onClose: () => void }) {
  const { gameId, squadId } = useUi(useShallow((s) => ({ gameId: s.gameId, squadId: s.squadId })))
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { players, gamePlayers, stats, lineups, clips, addGamePlayers, updateGamePlayer, removeGamePlayer } = useData()
  const home = gamePlayers.filter((g) => g.side === 'home')
  const squadPlayers = players.filter((p) => p.squadId === (game?.squadId ?? squadId)).sort((a, b) => a.number - b.number)
  const firstTime = home.length === 0

  const [rows, setRows] = useState<Row[]>(() => [
    ...squadPlayers.map((p) => {
      const g = home.find((x) => x.playerId === p.id)
      return { key: p.id, playerId: p.id, gpId: g?.id ?? null, name: p.name, base: p.number, on: firstTime || !!g, num: String(g?.number ?? p.number) }
    }),
    // Cầu thủ chỉ có trong trận này (thêm ở Live Stats, không thuộc tuyến).
    ...home.filter((g) => !g.playerId || !squadPlayers.some((p) => p.id === g.playerId))
      .map((g) => ({ key: g.id, playerId: null, gpId: g.id, name: g.name, base: null, on: true, num: String(g.number) })),
  ])
  const [err, setErr] = useState('')
  if (!game) return null

  const set = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const on = rows.filter((r) => r.on)
  const nums = on.map((r) => parseInt(r.num, 10))
  const dupNums = new Set(nums.filter((n, i) => nums.indexOf(n) !== i))
  const badRow = (r: Row) => { const n = parseInt(r.num, 10); return r.on && (isNaN(n) || n < 0 || n > 99 || dupNums.has(n)) }

  const save = async () => {
    if (on.some(badRow)) return setErr('Số áo phải từ 0 đến 99 và không trùng nhau trong đội.')
    // Bỏ khỏi danh sách trận: nếu đã có pha / thay người thì hỏi lại (các pha đó sẽ bị xoá).
    const drop = rows.filter((r) => !r.on && r.gpId)
    const busy = drop.filter((r) => stats.some((e) => e.gamePlayerId === r.gpId) || lineups.some((l) => l.gamePlayerId === r.gpId))
    if (busy.length && !(await confirmDialog({
      title: `Bỏ ${busy.length} cầu thủ khỏi trận?`,
      message: `${busy.map((r) => r.name).join(', ')} đã có pha thống kê / thay người trong trận này. Bỏ ra thì các pha đó cũng bị xoá.`,
      okText: 'Bỏ ra', danger: true,
    }))) return
    for (const r of drop) removeGamePlayer(r.gpId!)
    const add: { number: number; name: string; playerId: string | null }[] = []
    for (const r of on) {
      const n = parseInt(r.num, 10)
      const cur = home.find((g) => g.id === r.gpId)
      if (!cur) add.push({ number: n, name: r.name, playerId: r.playerId })
      else if (cur.number !== n || cur.name !== r.name) updateGamePlayer(cur.id, { number: n, name: r.name })
    }
    if (add.length) addGamePlayers(game.id, 'home', add)
    toast(`Đã lưu danh sách trận: ${on.length} cầu thủ`)
    onClose()
  }

  const tagged = (pid: string | null) => (pid ? clips.filter((c) => c.gameId === game.id && c.playerIds.includes(pid)).length : 0)

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack gr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Danh sách trận · {game.title}</b><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="muted small-note">Chọn ai có mặt trận này và số áo các bạn mặc <b>trong trận này</b>. Số áo mặc định của tuyến không đổi.</div>
        <div className="row wrap">
          <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, on: true })))}>Chọn tất cả</button>
          <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, on: false })))}>Bỏ chọn tất cả</button>
          <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => (x.base != null ? { ...x, num: String(x.base) } : x)))}>Về số mặc định</button>
        </div>
        <div className="gr-list">
          {rows.length === 0 && <div className="muted">Tuyến chưa có cầu thủ. Thêm ở module Cầu thủ trước.</div>}
          {rows.map((r) => (
            <label key={r.key} className={`gr-row ${r.on ? '' : 'off'}`}>
              <input type="checkbox" checked={r.on} onChange={(e) => set(r.key, { on: e.target.checked })} />
              <input className={`gr-num ${badRow(r) ? 'bad' : ''}`} inputMode="numeric" value={r.num} disabled={!r.on}
                onChange={(e) => set(r.key, { num: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              <span className="grow">{r.name}{r.playerId === null && <span className="muted small-note"> · chỉ trong trận này</span>}</span>
              {r.base != null && String(r.base) !== r.num && <span className="muted small-note">mặc định #{r.base}</span>}
              {tagged(r.playerId) > 0 && <span className="muted small-note">{tagged(r.playerId)} tình huống</span>}
            </label>
          ))}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row">
          <span className="muted small-note grow">{on.length} cầu thủ trong trận</span>
          <button className="btn" onClick={onClose}>Huỷ</button>
          <button className="btn primary" onClick={save}>Lưu</button>
        </div>
      </div>
    </div>
  )
}
