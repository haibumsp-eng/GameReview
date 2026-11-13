import { useState } from 'react'
import { useData, useUi } from '../store'
import { lineOf, pct, periodLabel, STAT_LABEL, type Line } from '../lib/boxscore'
import type { TeamSide } from '../types'

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
export function BoxScoreView() {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { gamePlayers, stats } = useData()
  const [open, setOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState(0) // 0 = cả trận
  if (!game) return null
  const ev = period ? stats.filter((e) => e.period === period) : stats
  const periods = [...new Set(stats.map((e) => e.period))].sort((a, b) => a - b)
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const pts = (s: TeamSide) => lineOf(ev.filter((e) => e.side === s)).pts

  const table = (side: TeamSide) => {
    const ps = gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
    const team = lineOf(ev.filter((e) => e.side === side))
    return (
      <div className="bs-team">
        <div className="bs-title"><span>{name(side)}</span><span className="bs-pts">{team.pts}</span></div>
        <div className="bs-scroll">
          <table className="bs-table">
            <thead><tr><th className="bs-no">No</th><th className="bs-name">Player</th>{COLS.map((c) => <th key={c.k}>{c.label}</th>)}</tr></thead>
            <tbody>
              {ps.map((p) => {
                const mine = ev.filter((e) => e.gamePlayerId === p.id)
                const l = lineOf(mine)
                return [
                  <tr key={p.id} className={`bs-row ${open === p.id ? 'open' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td className="bs-no">{p.number}</td><td className="bs-name">{p.name}</td>
                    {COLS.map((c) => <td key={c.k} className={c.k === 'pts' ? 'bs-strong' : ''}>{c.v(l)}</td>)}
                  </tr>,
                  open === p.id && (
                    <tr key={p.id + '-ev'} className="bs-events"><td colSpan={COLS.length + 2}>
                      {mine.length === 0 ? <span className="muted">Chưa có pha nào.</span> : [...mine].sort((a, b) => a.createdAt - b.createdAt).map((e) => (
                        <span key={e.id} className="tag bs-ev">{periodLabel(e.period)} · {STAT_LABEL[e.type]}</span>
                      ))}
                    </td></tr>
                  ),
                ]
              })}
              <tr className="bs-total"><td className="bs-no" /><td className="bs-name">TEAM</td>{COLS.map((c) => <td key={c.k}>{c.v(team)}</td>)}</tr>
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
