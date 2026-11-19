import { useData, useUi } from '../store'
import { lineOf, periodLabel } from '../lib/boxscore'
import { mmss } from '../lib/minutes'
import { foulStatus, periodScores, PLAYER_FOULS, starters, teamFouls } from '../lib/analytics'
import type { StatEvent, TeamSide } from '../types'

const CODE: Partial<Record<StatEvent['type'], string>> = { PF: 'P', PFS: 'P*', PFT: 'T', PFU: 'U', PFD: 'D' }
const PTS: Partial<Record<StatEvent['type'], number>> = { '2PM': 2, '3PM': 3, FTM: 1 }

/**
 * Biên bản trận đấu theo bố cục biên bản FIBA: lỗi từng cầu thủ (P/T/U/D kèm hiệp), lỗi đồng đội từng hiệp,
 * timeout, điểm chạy (running score) và điểm từng hiệp. In hoặc lưu PDF bằng trình duyệt.
 */
export function Scoresheet({ onClose }: { onClose: () => void }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { gamePlayers, stats, lineups } = useData()
  if (!game) return null
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const byTime = [...stats].sort((a, b) => a.createdAt - b.createdAt)
  const start = starters(lineups)
  const qs = periodScores(stats)
  const total = { home: lineOf(stats.filter((e) => e.side === 'home')).pts, away: lineOf(stats.filter((e) => e.side === 'away')).pts }

  // Điểm chạy: mỗi mốc điểm của mỗi đội ghi số áo người ghi; 2 điểm gạch 1 mốc, 3 điểm khoanh tròn, ném phạt là chấm.
  type Mark = { no: string; kind: 'ft' | 'two' | 'three' | 'skip'; endQ?: number }
  const ladder: Record<TeamSide, Map<number, Mark>> = { home: new Map(), away: new Map() }
  const run = { home: 0, away: 0 }
  const lastOfPeriod: Record<TeamSide, Map<number, number>> = { home: new Map(), away: new Map() }
  const noOf = (id: string | null) => (id ? String(gamePlayers.find((p) => p.id === id)?.number ?? '?') : 'T')
  for (const e of byTime) {
    const p = PTS[e.type]; if (!p) continue
    const s = e.side
    for (let k = 1; k < p; k++) ladder[s].set(run[s] + k, { no: '', kind: 'skip' })
    run[s] += p
    ladder[s].set(run[s], { no: noOf(e.gamePlayerId), kind: p === 1 ? 'ft' : p === 2 ? 'two' : 'three' })
    lastOfPeriod[s].set(e.period, run[s])
  }
  for (const s of ['home', 'away'] as TeamSide[]) for (const [q, n] of lastOfPeriod[s]) { const m = ladder[s].get(n); if (m) m.endQ = q }
  const rows = Math.max(160, Math.ceil(Math.max(total.home, total.away) / 40) * 40)
  const groups = Array.from({ length: rows / 40 }, (_, g) => g)
  const cell = (s: TeamSide, n: number) => {
    const m = ladder[s].get(n)
    return <td className={`rs-no ${m?.kind ?? ''} ${m?.endQ ? 'endq' : ''}`} title={m?.endQ ? `Hết ${periodLabel(m.endQ)}` : undefined}>{m?.kind === 'skip' ? '' : m?.no}</td>
  }

  const teamBlock = (s: TeamSide, letter: string) => {
    const ps = gamePlayers.filter((p) => p.side === s).sort((a, b) => a.number - b.number)
    const tmo = byTime.filter((e) => e.side === s && e.type === 'TMO')
    const coachT = byTime.filter((e) => e.side === s && e.type === 'PFT' && !e.gamePlayerId)
    return (
      <div className="ss-team">
        <div className="ss-team-head"><b>Đội {letter}: {name(s)}</b><span>Điểm: <b>{total[s]}</b></span></div>
        <div className="ss-row">
          <div><span className="ss-lbl">Timeout</span> {tmo.length ? tmo.map((e) => `${periodLabel(e.period)} ${e.clockS != null ? mmss(e.clockS) : ''}`).join(' · ') : '—'}</div>
          <div><span className="ss-lbl">Lỗi đồng đội</span> {[1, 2, 3, 4].map((q) => <span key={q} className="ss-tf">{periodLabel(q)}: <b>{q === 4 ? teamFouls(stats, s, 4) : teamFouls(stats, s, q)}</b></span>)}</div>
        </div>
        <table className="ss-players">
          <thead><tr><th>No</th><th className="l">Cầu thủ</th><th>ĐC</th><th colSpan={5}>Lỗi</th><th>Điểm</th></tr></thead>
          <tbody>
            {ps.map((p) => {
              const fouls = byTime.filter((e) => e.gamePlayerId === p.id && PLAYER_FOULS.includes(e.type))
              const fs = foulStatus(stats, p.id)
              const cells = fouls.map((f) => <span key={f.id}><b>{CODE[f.type]}</b><sub>{f.period <= 4 ? f.period : `OT${f.period - 4}`}</sub></span>)
              if (fs.out && cells.length < 5) cells.push(<b key="gd">GD</b>)
              return (
                <tr key={p.id}>
                  <td>{p.number}</td><td className="l">{p.name}</td><td>{start.has(p.id) ? 'x' : ''}</td>
                  {[0, 1, 2, 3, 4].map((i) => <td key={i} className="ss-f">{cells[i] ?? ''}</td>)}
                  <td>{lineOf(stats.filter((e) => e.gamePlayerId === p.id)).pts}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {coachT.length > 0 && <div className="ss-row"><span className="ss-lbl">Lỗi kỹ thuật HLV / ghế</span> {coachT.map((e) => periodLabel(e.period)).join(', ')}</div>}
      </div>
    )
  }

  return (
    <div className="ss-back">
      <div className="ss-tools">
        <b className="grow">Biên bản trận đấu</b>
        <button className="btn primary" onClick={() => window.print()}>🖨 In / Lưu PDF</button>
        <button className="btn" onClick={onClose}>Đóng</button>
      </div>
      <div className="ss-print">
        <div className="ss-title">
          <div><b>BIÊN BẢN TRẬN ĐẤU</b><br /><span>{game.title}{game.date ? ` · ${game.date}` : ''}</span></div>
          <div className="ss-final">{name('home')} <b>{total.home}</b> – <b>{total.away}</b> {name('away')}</div>
        </div>
        <table className="ss-q">
          <thead><tr><th className="l">Đội</th>{qs.map((q) => <th key={q.period}>{periodLabel(q.period)}</th>)}<th>Tổng</th></tr></thead>
          <tbody>{(['home', 'away'] as TeamSide[]).map((s, i) => <tr key={s}><td className="l">{i ? 'B' : 'A'}: {name(s)}</td>{qs.map((q) => <td key={q.period}>{q[s]}</td>)}<td><b>{total[s]}</b></td></tr>)}</tbody>
        </table>
        <div className="ss-cols">
          <div className="ss-left">{teamBlock('home', 'A')}{teamBlock('away', 'B')}</div>
          <div className="ss-right">
            <div className="ss-lbl">Điểm chạy (A | điểm | B)</div>
            <div className="ss-run">
              {groups.map((g) => (
                <table key={g} className="ss-rs">
                  <thead><tr><th>A</th><th /><th /><th>B</th></tr></thead>
                  <tbody>
                    {Array.from({ length: 40 }, (_, i) => g * 40 + i + 1).map((n) => (
                      <tr key={n}>{cell('home', n)}<td className="rs-n">{n}</td><td className="rs-n">{n}</td>{cell('away', n)}</tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
            <div className="ss-legend">Ký hiệu: số áo = 2 điểm (mốc ở giữa bỏ trống) · số áo khoanh tròn = 3 điểm · số áo có chấm = ném phạt · vạch đậm = hết hiệp · T = điểm không rõ cầu thủ.
              Lỗi: P cá nhân, P* khi ném, T kỹ thuật, U phản tinh thần thể thao, D truất quyền, GD bị truất quyền; số nhỏ là hiệp. ĐC = đá chính.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
