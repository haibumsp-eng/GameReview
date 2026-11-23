import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '../supabase'
import { useData, useUi, toast } from '../store'
import { confirmDialog } from '../lib/dialog'
import type { TeamSide } from '../types'

interface Row { key: string; playerId: string | null; gpId: string | null; name: string; base: number | null; on: boolean; num: string }
let seq = 0
const newKey = () => `new-${++seq}`

/** Đọc danh sách dán vào: mỗi dòng "số tên" (dán thẳng 2 cột từ Excel được). */
function parseLines(text: string) {
  return text.split('\n').map((l) => l.trim().match(/^#?(\d{1,2})\s*[\t,;.\-–:]*\s*(.*)$/)).filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ number: +m[1], name: m[2].trim() || `No ${m[1]}` }))
}

/**
 * Danh sách trận của một đội: ai có mặt trận này và mặc số áo nào.
 * Đội nhà: lấy từ cầu thủ của tuyến (số mặc định không đổi). Đội khách: nhập tay, dán danh sách, hoặc lấy lại từ trận trước.
 * Dùng chung cho Mổ băng và Live Stats.
 */
export function GameRosterModal({ side = 'home', onClose }: { side?: TeamSide; onClose: () => void }) {
  const { gameId, squadId } = useUi(useShallow((s) => ({ gameId: s.gameId, squadId: s.squadId })))
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { players, games, gamePlayers, stats, lineups, clips, addGamePlayers, updateGamePlayer, removeGamePlayer } = useData()
  const mine = gamePlayers.filter((g) => g.side === side)
  const squadPlayers = side === 'home' ? players.filter((p) => p.squadId === (game?.squadId ?? squadId)).sort((a, b) => a.number - b.number) : []
  const firstTime = mine.length === 0
  const teamName = side === 'home' ? game?.homeName || squad?.name || 'HOME' : game?.awayName || 'AWAY'

  const [rows, setRows] = useState<Row[]>(() => [
    ...squadPlayers.map((p) => {
      const g = mine.find((x) => x.playerId === p.id)
      return { key: p.id, playerId: p.id, gpId: g?.id ?? null, name: p.name, base: p.number, on: firstTime || !!g, num: String(g?.number ?? p.number) }
    }),
    // Cầu thủ chỉ có trong trận này (đội khách, hoặc người ngoài tuyến của đội nhà).
    ...mine.filter((g) => !g.playerId || !squadPlayers.some((p) => p.id === g.playerId)).sort((a, b) => a.number - b.number)
      .map((g) => ({ key: g.id, playerId: null, gpId: g.id, name: g.name, base: null, on: true, num: String(g.number) })),
  ])
  const [draft, setDraft] = useState({ num: '', name: '' })
  const [paste, setPaste] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [loadingPrev, setLoadingPrev] = useState(false)
  if (!game) return null

  const set = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const on = rows.filter((r) => r.on)
  const nums = on.map((r) => parseInt(r.num, 10))
  const dupNums = new Set(nums.filter((n, i) => nums.indexOf(n) !== i))
  const badRow = (r: Row) => { const n = parseInt(r.num, 10); return r.on && (isNaN(n) || n < 0 || n > 99 || dupNums.has(n) || !r.name.trim()) }
  const addRows = (list: { number: number; name: string }[]) => {
    const have = new Set(rows.filter((r) => r.on).map((r) => parseInt(r.num, 10)))
    const fresh = list.filter((x) => !have.has(x.number))
    setRows((r) => [...r, ...fresh.map((x) => ({ key: newKey(), playerId: null, gpId: null, name: x.name, base: null, on: true, num: String(x.number) }))])
    return list.length - fresh.length
  }
  const addOne = () => {
    const n = parseInt(draft.num, 10)
    if (isNaN(n) || n < 0 || n > 99) return setErr('Nhập số áo từ 0 đến 99')
    if (addRows([{ number: n, name: draft.name.trim() || `No ${n}` }])) return setErr(`Số ${n} đã có trong danh sách`)
    setErr(''); setDraft({ num: '', name: '' })
  }
  const addPaste = () => {
    const list = parseLines(paste ?? '')
    const skipped = addRows(list)
    setPaste(null); setErr(skipped ? `Bỏ ${skipped} dòng trùng số áo` : '')
  }

  // Lấy lại danh sách của đội này từ một trận trước (ưu tiên trận gặp cùng đối thủ).
  const prevGames = games.filter((g) => g.squadId === game.squadId && g.id !== game.id)
    .sort((a, b) => {
      const same = (g: typeof a) => (side === 'away' && (g.awayName ?? '').trim().toLowerCase() === (game.awayName ?? '').trim().toLowerCase() ? 0 : 1)
      return same(a) - same(b) || (b.date ?? '').localeCompare(a.date ?? '')
    })
  const loadPrev = async (gid: string) => {
    if (!gid) return
    setLoadingPrev(true)
    const { data, error } = await supabase.from('game_players').select('number, name, player_id').eq('game_id', gid).eq('side', side)
    setLoadingPrev(false)
    if (error) return setErr(error.message)
    const list = (data ?? []) as { number: number; name: string; player_id: string | null }[]
    if (!list.length) return setErr('Trận đó chưa có danh sách của đội này.')
    if (side === 'home') {
      // Đội nhà: chọn đúng những người đã đá trận đó với số áo trận đó.
      setRows((r) => r.map((x) => {
        const hit = list.find((l) => l.player_id && l.player_id === x.playerId)
        return x.playerId ? { ...x, on: !!hit, num: hit ? String(hit.number) : x.num } : x
      }))
      const skipped = addRows(list.filter((l) => !l.player_id || !squadPlayers.some((p) => p.id === l.player_id)).map((l) => ({ number: l.number, name: l.name })))
      setErr(skipped ? `Bỏ ${skipped} người trùng số áo` : '')
    } else {
      setRows((r) => r.filter((x) => x.gpId)) // bỏ các dòng mới chưa lưu, giữ người đã có
      const skipped = addRows(list.map((l) => ({ number: l.number, name: l.name })))
      setErr(skipped ? `Bỏ ${skipped} người trùng số áo đã có` : '')
    }
    toast(`Đã lấy ${list.length} cầu thủ từ trận trước`)
  }

  const save = async () => {
    if (on.some(badRow)) return setErr('Số áo phải từ 0 đến 99, không trùng nhau và có tên.')
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
      const n = parseInt(r.num, 10), nm = r.name.trim()
      const cur = mine.find((g) => g.id === r.gpId)
      if (!cur) add.push({ number: n, name: nm, playerId: r.playerId })
      else if (cur.number !== n || cur.name !== nm) updateGamePlayer(cur.id, { number: n, name: nm })
    }
    if (add.length) addGamePlayers(game.id, side, add)
    toast(`Đã lưu danh sách ${teamName}: ${on.length} cầu thủ`)
    onClose()
  }

  const tagged = (pid: string | null) => (pid ? clips.filter((c) => c.gameId === game.id && c.playerIds.includes(pid)).length : 0)

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack gr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Danh sách trận · {teamName} <span className="muted">({side === 'home' ? 'đội nhà' : 'đội khách'})</span></b><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="muted small-note">
          {side === 'home'
            ? <>Chọn ai có mặt trận này và số áo các bạn mặc <b>trong trận này</b>. Số áo mặc định của tuyến không đổi.</>
            : <>Nhập số áo và tên cầu thủ đội khách cho trận này. Có thể dán danh sách hoặc lấy lại từ trận trước rồi sửa số.</>}
        </div>
        <div className="row wrap">
          <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, on: true })))}>Chọn tất cả</button>
          <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, on: false })))}>Bỏ chọn tất cả</button>
          {side === 'home' && <button className="btn sm ghost" onClick={() => setRows((r) => r.map((x) => (x.base != null ? { ...x, num: String(x.base) } : x)))}>Về số mặc định</button>}
          <button className="btn sm ghost" onClick={() => setPaste(paste === null ? '' : null)}>Dán danh sách</button>
          {prevGames.length > 0 && (
            <select className="gr-prev" value="" disabled={loadingPrev} onChange={(e) => void loadPrev(e.target.value)}>
              <option value="">{loadingPrev ? 'Đang lấy…' : 'Lấy từ trận trước…'}</option>
              {prevGames.slice(0, 30).map((g) => <option key={g.id} value={g.id}>{g.date ? `${g.date} · ` : ''}{g.title}</option>)}
            </select>
          )}
        </div>
        {paste !== null && (
          <div className="stack">
            <textarea rows={5} autoFocus placeholder={'Mỗi dòng: số áo rồi tên\n4 Minh\n7 Nam\n(dán thẳng 2 cột từ Excel được)'} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <div className="row"><span className="muted small-note grow">{parseLines(paste).length} dòng đọc được</span><button className="btn sm" onClick={() => setPaste(null)}>Huỷ</button><button className="btn sm primary" onClick={addPaste}>Thêm vào danh sách</button></div>
          </div>
        )}
        <div className="gr-list">
          {rows.length === 0 && <div className="muted">Chưa có cầu thủ. Thêm ở dòng dưới hoặc dán danh sách.</div>}
          {rows.map((r) => (
            <label key={r.key} className={`gr-row ${r.on ? '' : 'off'}`}>
              <input type="checkbox" checked={r.on} onChange={(e) => set(r.key, { on: e.target.checked })} />
              <input className={`gr-num ${badRow(r) ? 'bad' : ''}`} inputMode="numeric" value={r.num} disabled={!r.on}
                onChange={(e) => set(r.key, { num: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              {r.playerId ? <span className="grow">{r.name}</span>
                : <input className="gr-name grow" value={r.name} disabled={!r.on} onChange={(e) => set(r.key, { name: e.target.value })} />}
              {side === 'home' && r.playerId === null && <span className="muted small-note">chỉ trận này</span>}
              {r.base != null && String(r.base) !== r.num && <span className="muted small-note">mặc định #{r.base}</span>}
              {tagged(r.playerId) > 0 && <span className="muted small-note">{tagged(r.playerId)} tình huống</span>}
            </label>
          ))}
        </div>
        <div className="row gr-add">
          <input className="gr-num" placeholder="#" inputMode="numeric" value={draft.num} onChange={(e) => setDraft({ ...draft, num: e.target.value.replace(/\D/g, '').slice(0, 2) })} onKeyDown={(e) => e.key === 'Enter' && addOne()} />
          <input className="grow" placeholder={side === 'home' ? 'Thêm người chỉ đá trận này' : 'Tên cầu thủ đội khách'} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addOne()} />
          <button className="btn sm" onClick={addOne}>+ Thêm</button>
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
