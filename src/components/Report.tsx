import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useData, useUi } from '../store'
import { lineOf, pct, periodLabel } from '../lib/boxscore'
import { clockNow, mmss, plusMinus, secondsPlayed } from '../lib/minutes'
import { eff, periodScores, starters } from '../lib/analytics'
import type { TeamSide } from '../types'
import { Analysis } from './Analysis'

/**
 * Báo cáo trận đấu để HLV đọc / in / lưu PDF: tỉ số theo hiệp, box score 2 đội rút gọn, rồi toàn bộ phân tích và shot chart.
 * Mở bằng nút "📄 PDF", bấm In rồi chọn "Lưu thành PDF". (CSV dành cho nhập liệu vào bảng tính.)
 */
export function ReportModal({ onClose }: { onClose: () => void }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { gamePlayers, stats, lineups } = useData()
  // Khi in: ẩn cả ứng dụng, chỉ in báo cáo (đặt thẳng dưới <body> để chia trang A4 dọc đúng).
  useEffect(() => { document.body.classList.add('print-report'); return () => document.body.classList.remove('print-report') }, [])
  if (!game) return null
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const total = { home: lineOf(stats.filter((e) => e.side === 'home')).pts, away: lineOf(stats.filter((e) => e.side === 'away')).pts }
  const qs = periodScores(stats)
  const secs = secondsPlayed(lineups, game.periodLen ?? 600, game.clockPeriod ?? 1, clockNow(game))
  const pm = plusMinus(lineups, stats)
  const start = starters(lineups)
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  const box = (side: TeamSide) => {
    const ps = gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
    const ev = stats.filter((e) => e.side === side)
    const t = lineOf(ev)
    const tm = lineOf(ev.filter((e) => !e.gamePlayerId))
    const row = (l: ReturnType<typeof lineOf>) => [l.pts, `${l.fgm}/${l.fga}`, `${l.p3m}/${l.p3a}`, `${l.ftm}/${l.fta}`, l.oreb, l.dreb, l.reb, l.ast, l.stl, l.blk, l.tov, l.pf, eff(l)]
    return (
      <div className="rp-team" key={side}>
        <div className="rp-team-head"><b>{name(side)}</b><span>{total[side]}</span></div>
        <table className="rp-box">
          <thead><tr><th>No</th><th className="l">Cầu thủ</th><th>MIN</th>{['PTS', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'EFF'].map((h) => <th key={h}>{h}</th>)}<th>+/-</th></tr></thead>
          <tbody>
            {ps.map((p) => {
              const l = lineOf(ev.filter((e) => e.gamePlayerId === p.id))
              return (
                <tr key={p.id} className={secs.has(p.id) ? '' : 'dnp'}>
                  <td>{start.has(p.id) ? '*' : ''}{p.number}</td><td className="l">{p.name}</td><td>{secs.has(p.id) ? mmss(secs.get(p.id)!) : 'DNP'}</td>
                  {row(l).map((v, i) => <td key={i} className={i === 0 ? 'b' : ''}>{v}</td>)}
                  <td>{sign(pm.get(p.id) ?? 0)}</td>
                </tr>
              )
            })}
            {(tm.reb || tm.tov) ? <tr className="team"><td /><td className="l">Team</td><td />{row(tm).map((v, i) => <td key={i}>{[4, 5, 6, 10].includes(i) ? v : ''}</td>)}<td /></tr> : null}
            <tr className="tot"><td /><td className="l">Totals</td><td>{mmss(ps.reduce((a, p) => a + (secs.get(p.id) ?? 0), 0))}</td>{row(t).map((v, i) => <td key={i}>{v}</td>)}<td>{sign(t.pts - lineOf(stats.filter((e) => e.side !== side)).pts)}</td></tr>
          </tbody>
        </table>
        <div className="rp-shoot">FG {pct(t.fgm, t.fga)} · 3PT {pct(t.p3m, t.p3a)} · FT {pct(t.ftm, t.fta)}</div>
      </div>
    )
  }

  return createPortal(
    <div className="ss-back report-back">
      <div className="ss-tools">
        <b className="grow">Báo cáo trận đấu</b>
        <span className="muted small-note">Bấm In, rồi chọn “Lưu thành PDF”</span>
        <button className="btn primary" onClick={() => window.print()}>🖨 In / Lưu PDF</button>
        <button className="btn" onClick={onClose}>Đóng</button>
      </div>
      <div className="report-print">
        <div className="rp-title">
          <div><b>BÁO CÁO TRẬN ĐẤU</b><br /><span>{game.title}{game.date ? ` · ${game.date}` : ''}</span></div>
          <div className="rp-final">{name('home')} <b>{total.home}</b> – <b>{total.away}</b> {name('away')}</div>
        </div>
        <table className="rp-q">
          <thead><tr><th className="l">Đội</th>{qs.map((q) => <th key={q.period}>{periodLabel(q.period)}</th>)}<th>Tổng</th></tr></thead>
          <tbody>{(['home', 'away'] as TeamSide[]).map((s) => <tr key={s}><td className="l">{name(s)}</td>{qs.map((q) => <td key={q.period}>{q[s]}</td>)}<td><b>{total[s]}</b></td></tr>)}</tbody>
        </table>
        <h3 className="rp-h">Box score</h3>
        {box('home')}
        {box('away')}
        <div className="rp-note">* = đá chính · MIN tính theo đồng hồ thi đấu · EFF = (PTS + REB + AST + STL + BLK) − (ném trượt + ném phạt trượt + mất bóng) · +/- = hiệu số điểm khi cầu thủ trên sân</div>
        <h3 className="rp-h rp-break">Phân tích</h3>
        <Analysis print />
      </div>
    </div>,
    document.body,
  )
}
