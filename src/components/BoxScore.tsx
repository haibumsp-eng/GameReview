import { useState } from 'react'
import { useData, useUi, toast } from '../store'
import { lineOf, pct, periodLabel, STAT_LABEL, type Line } from '../lib/boxscore'
import type { TeamSide } from '../types'
import { clockNow, mmss, plusMinus, secondsPlayed } from '../lib/minutes'
import { confirmDialog } from '../lib/dialog'
import { eff, foulStatus, starters } from '../lib/analytics'
import { Scoresheet } from './Scoresheet'
import { downloadCsv, type Cell } from '../lib/csv'

const COLS: { k: string; label: string; v: (l: Line) => string | number }[] = [
  { k: 'pts', label: 'PTS', v: (l) => l.pts },
  { k: 'fg', label: 'FG', v: (l) => `${l.fgm}/${l.fga}` }, { k: 'fgp', label: 'FG%', v: (l) => pct(l.fgm, l.fga) },
  { k: '2p', label: '2PT', v: (l) => `${l.p2m}/${l.p2a}` }, { k: '2pp', label: '2PT%', v: (l) => pct(l.p2m, l.p2a) },
  { k: '3p', label: '3PT', v: (l) => `${l.p3m}/${l.p3a}` }, { k: '3pp', label: '3PT%', v: (l) => pct(l.p3m, l.p3a) },
  { k: 'ft', label: 'FT', v: (l) => `${l.ftm}/${l.fta}` }, { k: 'ftp', label: 'FT%', v: (l) => pct(l.ftm, l.fta) },
  { k: 'oreb', label: 'OREB', v: (l) => l.oreb }, { k: 'dreb', label: 'DREB', v: (l) => l.dreb }, { k: 'reb', label: 'REB', v: (l) => l.reb },
  { k: 'ast', label: 'AST', v: (l) => l.ast }, { k: 'stl', label: 'STL', v: (l) => l.stl }, { k: 'blk', label: 'BLK', v: (l) => l.blk },
  { k: 'tov', label: 'TOV', v: (l) => l.tov }, { k: 'pf', label: 'PF', v: (l) => l.pf },
  { k: 'eff', label: 'EFF', v: (l) => eff(l) },
]
// FD (fouls drawn: số lần bị phạm lỗi) chèn sau PF, tính riêng vì không nằm trong pha của cầu thủ.
const FD_AFTER = 'pf'

/** Box score 2 đội kiểu FIBA (hiển thị ngay trong trang). Bấm một cầu thủ để xem từng pha. */
export function BoxScoreView(props: { onSeek?: (videoId: string, t: number) => void; editable?: boolean }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { gamePlayers, stats, lineups, updateGamePlayer, removeGamePlayer, addGamePlayers } = useData()
  const [editing, setEditing] = useState<TeamSide | null>(null)
  const [draft, setDraft] = useState({ number: '', name: '' })
  const [open, setOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState(0) // 0 = cả trận
  const [sheet, setSheet] = useState(false)
  if (!game) return null
  const ev = period ? stats.filter((e) => e.period === period) : stats
  const periods = [...new Set(stats.map((e) => e.period))].sort((a, b) => a - b)
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const pts = (s: TeamSide) => lineOf(ev.filter((e) => e.side === s)).pts
  // MIN và +/- tính cho cả trận (theo đồng hồ thi đấu hiện tại).
  const secs = secondsPlayed(lineups, game.periodLen ?? 600, game.clockPeriod ?? 1, clockNow(game))
  const pm = plusMinus(lineups, stats)
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const start = starters(lineups)

  // Sửa số áo / tên: kiểm tra số hợp lệ và không trùng trong đội.
  const numberTaken = (side: TeamSide, n: number, exceptId?: string) => gamePlayers.some((p) => p.side === side && p.number === n && p.id !== exceptId)
  const saveNumber = (id: string, side: TeamSide, raw: string, old: number) => {
    const n = parseInt(raw, 10)
    if (raw.trim() === String(old)) return
    if (isNaN(n) || n < 0 || n > 99) { toast('Số áo phải từ 0 đến 99'); return false }
    if (numberTaken(side, n, id)) { toast(`Số ${n} đã có trong đội`); return false }
    updateGamePlayer(id, { number: n })
  }
  const saveName = (id: string, raw: string, old: string) => { const v = raw.trim(); if (v && v !== old) updateGamePlayer(id, { name: v }) }
  // Chưa có pha nào thì xoá ngay; đã có thì hỏi lại một lần.
  const remove = async (id: string, label: string) => {
    const n = stats.filter((e) => e.gamePlayerId === id).length + lineups.filter((e) => e.gamePlayerId === id).length
    if (n && !(await confirmDialog({ title: `Xoá ${label}?`, message: `${n} pha / lần thay người của cầu thủ này cũng bị xoá.`, okText: 'Xoá', danger: true }))) return
    removeGamePlayer(id)
  }
  const addRow = (side: TeamSide) => {
    const n = parseInt(draft.number, 10)
    if (isNaN(n) || n < 0 || n > 99) return toast('Nhập số áo từ 0 đến 99')
    if (numberTaken(side, n)) return toast(`Số ${n} đã có trong đội`)
    if (!game) return
    addGamePlayers(game.id, side, [{ number: n, name: draft.name.trim() || `No ${n}` }])
    setDraft({ number: '', name: '' })
  }

  // Xuất CSV: 2 đội trong một file, mỗi cột một số (ném trúng / ném / %) để dùng được trong Excel, Google Sheets.
  const exportCsv = () => {
    const pctN = (m: number, a: number) => (a ? Math.round((m / a) * 1000) / 10 : '')
    const head: Cell[] = ['Đội', 'No', 'Cầu thủ', 'Đá chính', 'MIN (phút)', 'PTS', 'FGM', 'FGA', 'FG%', '2PM', '2PA', '2P%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'FD', 'EFF', 'Plus/Minus']
    const line = (l: ReturnType<typeof lineOf>): Cell[] => [l.pts, l.fgm, l.fga, pctN(l.fgm, l.fga), l.p2m, l.p2a, pctN(l.p2m, l.p2a), l.p3m, l.p3a, pctN(l.p3m, l.p3a), l.ftm, l.fta, pctN(l.ftm, l.fta), l.oreb, l.dreb, l.reb, l.ast, l.stl, l.blk, l.tov, l.pf]
    const rows: Cell[][] = [[`Box score: ${game.title}`, game.date || '', period ? periodLabel(period) : 'Full game'], [`${name('home')} ${pts('home')} - ${pts('away')} ${name('away')}`], [], head]
    for (const side of ['home', 'away'] as TeamSide[]) {
      const ps = gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
      for (const p of ps) {
        const l = lineOf(ev.filter((e) => e.gamePlayerId === p.id))
        rows.push([name(side), p.number, p.name, start.has(p.id) ? 'x' : '', secs.has(p.id) ? Math.round((secs.get(p.id)! / 60) * 100) / 100 : 'DNP', ...line(l), ev.filter((e) => e.drawnBy === p.id).length, eff(l), pm.get(p.id) ?? 0])
      }
      const tl = lineOf(ev.filter((e) => e.side === side && !e.gamePlayerId))
      if (tl.reb || tl.tov) rows.push([name(side), '', 'Team', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', tl.oreb, tl.dreb, tl.reb, '', '', '', tl.tov, '', '', '', ''])
      const t = lineOf(ev.filter((e) => e.side === side))
      const other = lineOf(ev.filter((e) => e.side !== side))
      rows.push([name(side), '', 'Totals', '', Math.round((ps.reduce((a, p) => a + (secs.get(p.id) ?? 0), 0) / 60) * 100) / 100, ...line(t), ev.filter((e) => e.side !== side && e.drawnBy).length, eff(t), t.pts - other.pts], [])
    }
    downloadCsv(`${game.title} - boxscore${period ? ' ' + periodLabel(period) : ''}`, rows)
  }

  const table = (side: TeamSide) => {
    const ps = gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
    const edit = editing === side
    const team = lineOf(ev.filter((e) => e.side === side))
    return (
      <div className="bs-team">
        <div className="bs-title">
          <span>{name(side)}</span>
          <span className="row">
            {props.editable && <button className={`btn sm ${edit ? 'primary' : 'ghost'}`} onClick={() => { setEditing(edit ? null : side); setOpen(null); setDraft({ number: '', name: '' }) }}>{edit ? '✓ Xong' : '✎ Sửa danh sách'}</button>}
            <span className="bs-pts">{team.pts}</span>
          </span>
        </div>
        <div className="bs-scroll">
          <table className="bs-table">
            <thead><tr><th className="bs-no">No</th><th className="bs-name">Player</th><th>MIN</th>{COLS.map((c) => [<th key={c.k}>{c.label}</th>, c.k === FD_AFTER && <th key="fd" title="Fouls drawn: số lần bị phạm lỗi">FD</th>])}<th>+/-</th>{edit && <th />}</tr></thead>
            <tbody>
              {ps.map((p) => {
                const mine = ev.filter((e) => e.gamePlayerId === p.id)
                const l = lineOf(mine)
                return [
                  <tr key={p.id} className={`bs-row ${open === p.id ? 'open' : ''} ${edit ? 'editing' : ''}`} title={props.editable ? 'Shift + click: xoá cầu thủ' : undefined}
                    onClick={(e) => { if (e.shiftKey && props.editable) { e.preventDefault(); return remove(p.id, `#${p.number} ${p.name}`) } if (!edit) setOpen(open === p.id ? null : p.id) }}>
                    {edit ? (
                      <>
                        <td className="bs-no"><input className="bs-in num" defaultValue={p.number} inputMode="numeric" key={'n' + p.number}
                          onBlur={(e) => { if (saveNumber(p.id, side, e.target.value, p.number) === false) e.target.value = String(p.number) }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
                        <td className="bs-name"><input className="bs-in" defaultValue={p.name} key={'m' + p.name}
                          onBlur={(e) => saveName(p.id, e.target.value, p.name)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
                      </>
                    ) : <><td className="bs-no">{start.has(p.id) ? '*' : ''}{p.number}</td><td className="bs-name">{p.name}</td></>}
                    <td>{secs.has(p.id) ? mmss(secs.get(p.id)!) : 'DNP'}</td>
                    {COLS.map((c) => [<td key={c.k} className={c.k === 'pts' ? 'bs-strong' : c.k === 'pf' && foulStatus(stats, p.id).out ? 'bs-minus' : ''}>{c.v(l)}{c.k === 'pf' && foulStatus(stats, p.id).out ? ' DQ' : ''}</td>,
                      c.k === FD_AFTER && <td key="fd">{ev.filter((e) => e.drawnBy === p.id).length}</td>])}
                    <td className={(pm.get(p.id) ?? 0) > 0 ? 'bs-plus' : (pm.get(p.id) ?? 0) < 0 ? 'bs-minus' : ''}>{sign(pm.get(p.id) ?? 0)}</td>
                    {edit && <td><button className="icon-btn" title="Xoá cầu thủ" onClick={() => remove(p.id, `#${p.number} ${p.name}`)}>×</button></td>}
                  </tr>,
                  open === p.id && (
                    <tr key={p.id + '-ev'} className="bs-events"><td colSpan={COLS.length + 5}>
                      {mine.length === 0 ? <span className="muted">Chưa có pha nào.</span> : [...mine].sort((a, b) => a.createdAt - b.createdAt).map((e) => (
                        <button key={e.id} className="tag bs-ev" disabled={!e.videoId || e.videoT == null || !props.onSeek}
                          onClick={() => e.videoId && e.videoT != null && props.onSeek?.(e.videoId, Math.max(0, e.videoT - 3))}>
                          {periodLabel(e.period)}{e.clockS != null ? ` ${mmss(e.clockS)}` : ''} · {STAT_LABEL[e.type]}{e.videoT != null ? ' ▶' : ''}
                        </button>
                      ))}
                    </td></tr>
                  ),
                ]
              })}
              {edit && (
                <tr className="bs-add">
                  <td className="bs-no"><input className="bs-in num" placeholder="#" inputMode="numeric" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} onKeyDown={(e) => e.key === 'Enter' && addRow(side)} /></td>
                  <td className="bs-name"><input className="bs-in" placeholder="Tên cầu thủ mới" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addRow(side)} /></td>
                  <td colSpan={COLS.length + 4} style={{ textAlign: 'left' }}><button className="btn sm primary" onClick={() => addRow(side)}>+ Thêm</button></td>
                </tr>
              )}
              {(() => {
                // Dòng TEAM: pha của đội không gắn cầu thủ (team rebound, team turnover).
                const tl = lineOf(ev.filter((e) => e.side === side && !e.gamePlayerId))
                if (!tl.reb && !tl.tov) return null
                return <tr className="bs-teamrow"><td className="bs-no" /><td className="bs-name">Team</td><td />{COLS.map((c) => [<td key={c.k}>{c.k === 'oreb' ? tl.oreb : c.k === 'dreb' ? tl.dreb : c.k === 'reb' ? tl.reb : c.k === 'tov' ? tl.tov : ''}</td>, c.k === FD_AFTER && <td key="fd" />])}<td /></tr>
              })()}
              <tr className="bs-total"><td className="bs-no" /><td className="bs-name">Totals</td><td>{mmss(ps.reduce((a, p) => a + (secs.get(p.id) ?? 0), 0))}</td>{COLS.map((c) => [<td key={c.k}>{c.v(team)}</td>, c.k === FD_AFTER && <td key="fd">{ev.filter((e) => e.side !== side && e.drawnBy).length}</td>])}<td>{sign(team.pts - lineOf(ev.filter((e) => e.side !== side)).pts)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="bs-view stack">
      <div className="row">
        <div className="bs-score grow">{name('home')} <b>{pts('home')}</b> – <b>{pts('away')}</b> {name('away')}</div>
        <button className="btn sm" onClick={exportCsv} title="Tải box score 2 đội dạng CSV (mở bằng Excel / Google Sheets)">⬇ CSV</button>
        <button className="btn sm" onClick={() => setSheet(true)}>🖨 Biên bản</button>
        <select style={{ width: 140 }} value={period} onChange={(e) => setPeriod(+e.target.value)}>
          <option value={0}>Full game</option>
          {periods.map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}
        </select>
      </div>
      {table('home')}
      {table('away')}
      {sheet && <Scoresheet onClose={() => setSheet(false)} />}
    </div>
  )
}
