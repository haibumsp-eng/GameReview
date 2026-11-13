import { useState } from 'react'
import { useData, useUi } from '../store'
import { lineOf, pct, periodLabel, STAT_LABEL, type Line } from '../lib/boxscore'
import type { TeamSide } from '../types'
import { clockNow, mmss, plusMinus, secondsPlayed } from '../lib/minutes'

const COLS: { k: string; label: string; v: (l: Line) => string | number }[] = [
  { k: 'pts', label: 'PTS', v: (l) => l.pts },
  { k: 'fg', label: 'FG', v: (l) => `${l.fgm}/${l.fga}` }, { k: 'fgp', label: 'FG%', v: (l) => pct(l.fgm, l.fga) },
  { k: '2p', label: '2PT', v: (l) => `${l.p2m}/${l.p2a}` }, { k: '2pp', label: '2PT%', v: (l) => pct(l.p2m, l.p2a) },
  { k: '3p', label: '3PT', v: (l) => `${l.p3m}/${l.p3a}` }, { k: '3pp', label: '3PT%', v: (l) => pct(l.p3m, l.p3a) },
  { k: 'ft', label: 'FT', v: (l) => `${l.ftm}/${l.fta}` }, { k: 'ftp', label: 'FT%', v: (l) => pct(l.ftm, l.fta) },
  { k: 'oreb', label: 'OREB', v: (l) => l.oreb }, { k: 'dreb', label: 'DREB', v: (l) => l.dreb }, { k: 'reb', label: 'REB', v: (l) => l.reb },
  { k: 'ast', label: 'AST', v: (l) => l.ast }, { k: 'stl', label: 'STL', v: (l) => l.stl }, { k: 'blk', label: 'BLK', v: (l) => l.blk },
  { k: 'tov', label: 'TOV', v: (l) => l.tov }, { k: 'pf', label: 'PF', v: (l) => l.pf },
]

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
  if (!game) return null
  const ev = period ? stats.filter((e) => e.period === period) : stats
  const periods = [...new Set(stats.map((e) => e.period))].sort((a, b) => a - b)
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const pts = (s: TeamSide) => lineOf(ev.filter((e) => e.side === s)).pts
  // MIN và +/- tính cho cả trận (theo đồng hồ thi đấu hiện tại).
  const secs = secondsPlayed(lineups, game.periodLen ?? 600, game.clockPeriod ?? 1, clockNow(game))
  const pm = plusMinus(lineups, stats)
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  // Sửa số áo / tên: kiểm tra số hợp lệ và không trùng trong đội.
  const numberTaken = (side: TeamSide, n: number, exceptId?: string) => gamePlayers.some((p) => p.side === side && p.number === n && p.id !== exceptId)
  const saveNumber = (id: string, side: TeamSide, raw: string, old: number) => {
    const n = parseInt(raw, 10)
    if (raw.trim() === String(old)) return
    if (isNaN(n) || n < 0 || n > 99) { alert('Số áo phải từ 0 đến 99.'); return false }
    if (numberTaken(side, n, id)) { alert(`Số ${n} đã có trong đội.`); return false }
    updateGamePlayer(id, { number: n })
  }
  const saveName = (id: string, raw: string, old: string) => { const v = raw.trim(); if (v && v !== old) updateGamePlayer(id, { name: v }) }
  const remove = (id: string, label: string) => {
    const n = stats.filter((e) => e.gamePlayerId === id).length + lineups.filter((e) => e.gamePlayerId === id).length
    if (confirm(n ? `Xoá ${label}? ${n} pha / lần thay người của cầu thủ này cũng bị xoá.` : `Xoá ${label} khỏi trận?`)) removeGamePlayer(id)
  }
  const addRow = (side: TeamSide) => {
    const n = parseInt(draft.number, 10)
    if (isNaN(n) || n < 0 || n > 99) return alert('Nhập số áo từ 0 đến 99.')
    if (numberTaken(side, n)) return alert(`Số ${n} đã có trong đội.`)
    if (!game) return
    addGamePlayers(game.id, side, [{ number: n, name: draft.name.trim() || `No ${n}` }])
    setDraft({ number: '', name: '' })
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
            <thead><tr><th className="bs-no">No</th><th className="bs-name">Player</th><th>MIN</th>{COLS.map((c) => <th key={c.k}>{c.label}</th>)}<th>+/-</th>{edit && <th />}</tr></thead>
            <tbody>
              {ps.map((p) => {
                const mine = ev.filter((e) => e.gamePlayerId === p.id)
                const l = lineOf(mine)
                return [
                  <tr key={p.id} className={`bs-row ${open === p.id ? 'open' : ''} ${edit ? 'editing' : ''}`} onClick={() => !edit && setOpen(open === p.id ? null : p.id)}>
                    {edit ? (
                      <>
                        <td className="bs-no"><input className="bs-in num" defaultValue={p.number} inputMode="numeric" key={'n' + p.number}
                          onBlur={(e) => { if (saveNumber(p.id, side, e.target.value, p.number) === false) e.target.value = String(p.number) }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
                        <td className="bs-name"><input className="bs-in" defaultValue={p.name} key={'m' + p.name}
                          onBlur={(e) => saveName(p.id, e.target.value, p.name)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
                      </>
                    ) : <><td className="bs-no">{p.number}</td><td className="bs-name">{p.name}</td></>}
                    <td>{secs.has(p.id) ? mmss(secs.get(p.id)!) : 'DNP'}</td>
                    {COLS.map((c) => <td key={c.k} className={c.k === 'pts' ? 'bs-strong' : ''}>{c.v(l)}</td>)}
                    <td className={(pm.get(p.id) ?? 0) > 0 ? 'bs-plus' : (pm.get(p.id) ?? 0) < 0 ? 'bs-minus' : ''}>{sign(pm.get(p.id) ?? 0)}</td>
                    {edit && <td><button className="icon-btn" title="Xoá cầu thủ" onClick={() => remove(p.id, `#${p.number} ${p.name}`)}>×</button></td>}
                  </tr>,
                  open === p.id && (
                    <tr key={p.id + '-ev'} className="bs-events"><td colSpan={COLS.length + 4}>
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
                  <td colSpan={COLS.length + 3} style={{ textAlign: 'left' }}><button className="btn sm primary" onClick={() => addRow(side)}>+ Thêm</button></td>
                </tr>
              )}
              <tr className="bs-total"><td className="bs-no" /><td className="bs-name">TEAM</td><td>{mmss(ps.reduce((a, p) => a + (secs.get(p.id) ?? 0), 0))}</td>{COLS.map((c) => <td key={c.k}>{c.v(team)}</td>)}<td>{sign(team.pts - lineOf(ev.filter((e) => e.side !== side)).pts)}</td></tr>
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
        <select style={{ width: 140 }} value={period} onChange={(e) => setPeriod(+e.target.value)}>
          <option value={0}>Full game</option>
          {periods.map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}
        </select>
      </div>
      {table('home')}
      {table('away')}
    </div>
  )
}
