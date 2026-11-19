import { useData, useUi } from '../store'
import { lineOf, pct, periodLabel } from '../lib/boxscore'
import { clockNow, mmss } from '../lib/minutes'
import { advanced, assists, eff, flow, lineupUnits, periodScores, pointSources, starters, timeouts, zoneStats, ZONE_LABEL, type Zone } from '../lib/analytics'
import { Court } from './Court'
import type { TeamSide } from '../types'

const p1 = (x: number | null) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`)
const n1 = (x: number | null) => (x == null ? '–' : x.toFixed(1))

/** Trang Phân tích: các chỉ số kiểu FIBA tính từ những pha đã ghi, giúp HLV đọc trận. */
export function Analysis() {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === game?.squadId))
  const { stats, lineups, gamePlayers } = useData()
  if (!game) return null

  const len = game.periodLen ?? 600
  const period = game.clockPeriod ?? 1
  const remaining = clockNow(game)
  const name = (s: TeamSide) => (s === 'home' ? game.homeName || squad?.name || 'HOME' : game.awayName || 'AWAY')
  const mine = (s: TeamSide) => stats.filter((e) => e.side === s)
  const adv = { home: advanced(mine('home'), mine('away')), away: advanced(mine('away'), mine('home')) }
  const src = pointSources(stats, lineups)
  const fl = flow(stats, len, period, remaining)
  const qs = periodScores(stats)
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const start = starters(lineups)
  const L = { home: adv.home.line, away: adv.away.line }
  const tmo = (s: TeamSide) => stats.filter((e) => e.side === s && e.type === 'TMO').length
  const ast = assists(stats)
  const madeFG = (s: TeamSide) => stats.filter((e) => e.side === s && (e.type === '2PM' || e.type === '3PM'))
  const assisted = (s: TeamSide) => madeFG(s).filter((e) => ast.has(e.id)).length
  const fd = (s: TeamSide) => stats.filter((e) => e.side !== s && e.drawnBy).length

  // Một dòng so sánh: giá trị HOME | tên chỉ số | giá trị AWAY. better: bên nào tốt hơn (số lớn hơn / nhỏ hơn).
  type Row = { label: string; h: string | number; a: string | number; hv?: number | null; av?: number | null; lower?: boolean; note?: string }
  const row = (r: Row) => {
    const hv = r.hv ?? (typeof r.h === 'number' ? r.h : null), av = r.av ?? (typeof r.a === 'number' ? r.a : null)
    const win = hv == null || av == null || hv === av ? null : (hv > av) !== !!r.lower ? 'home' : 'away'
    return (
      <tr key={r.label}>
        <td className={`an-v ${win === 'home' ? 'win home' : ''}`}>{r.h}</td>
        <td className="an-l">{r.label}{r.note && <span className="an-note" title={r.note}>*</span>}</td>
        <td className={`an-v ${win === 'away' ? 'win away' : ''}`}>{r.a}</td>
      </tr>
    )
  }
  const section = (title: string, rows: Row[]) => (
    <div className="card stack an-sec">
      <b>{title}</b>
      <table className="an-table">
        <thead><tr><th className="an-v">{name('home')}</th><th /><th className="an-v">{name('away')}</th></tr></thead>
        <tbody>{rows.map(row)}</tbody>
      </table>
    </div>
  )
  const EST = 'Ước tính từ thứ tự các pha: cần ghi đủ rebound (kể cả TEAM REB) và mất bóng (kể cả TEAM TOV) thì mới chính xác.'
  const mm = (s: number) => mmss(s)

  const leaders = (s: TeamSide) => gamePlayers.filter((p) => p.side === s)
    .map((p) => ({ p, l: lineOf(stats.filter((e) => e.gamePlayerId === p.id)) }))
    .filter((x) => x.l.pts || x.l.reb || x.l.ast || x.l.fga || x.l.tov)
    .sort((a, b) => eff(b.l) - eff(a.l)).slice(0, 3)

  const units = (s: TeamSide) => {
    const u = lineupUnits(s, lineups, stats, len, period, remaining).slice(0, 6)
    return (
      <div className="card stack an-sec">
        <b>Đội hình 5 người · {name(s)}</b>
        {u.length === 0 ? <div className="muted small-note">Chưa có đội hình đủ 5 người trên sân.</div> : (
          <table className="an-units">
            <thead><tr><th>Đội hình</th><th>MIN</th><th>Ghi</th><th>Thủng</th><th>+/-</th></tr></thead>
            <tbody>
              {u.map((x) => {
                const d = x.pf - x.pa
                return (
                  <tr key={x.ids.join()}>
                    <td className="an-five">{x.ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a!.number - b!.number).map((p) => <span key={p!.id} title={p!.name}>#{p!.number}</span>)}</td>
                    <td>{mm(x.secs)}</td><td>{x.pf}</td><td>{x.pa}</td>
                    <td className={d > 0 ? 'bs-plus' : d < 0 ? 'bs-minus' : ''}>{d > 0 ? `+${d}` : d}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="an stack">
      <div className="card stack an-sec">
        <b>Điểm theo hiệp</b>
        <table className="an-q">
          <thead><tr><th />{qs.map((q) => <th key={q.period}>{periodLabel(q.period)}</th>)}<th>Tổng</th></tr></thead>
          <tbody>
            {(['home', 'away'] as TeamSide[]).map((s) => (
              <tr key={s}><td className="an-team"><span className={`st-dot ${s}`} />{name(s)}</td>{qs.map((q) => <td key={q.period}>{q[s] || (q.period > period ? '' : 0)}</td>)}<td className="bs-strong">{L[s].pts}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="an-grid">
        {section('Nguồn điểm', [
          { label: 'Points in the paint', h: src.paint.home, a: src.paint.away, note: 'Cú ném 2 điểm được bật "Trong paint" khi ghi.' },
          { label: 'Points from turnovers', h: src.offTov.home, a: src.offTov.away, note: EST },
          { label: 'Second chance points', h: src.secondChance.home, a: src.secondChance.away, note: EST },
          { label: 'Fast break points', h: src.fastBreak.home, a: src.fastBreak.away, note: 'Cú ném được bật "Fast break" khi ghi.' },
          { label: 'Bench points', h: src.bench.home, a: src.bench.away, note: 'Điểm của cầu thủ không đá chính (đá chính = 5 người vào sân đầu tiên ở Q1).' },
        ])}
        {section('Diễn biến', [
          { label: 'Biggest lead', h: fl.biggestLead.home, a: fl.biggestLead.away },
          { label: 'Biggest scoring run', h: fl.biggestRun.home, a: fl.biggestRun.away, note: 'Số điểm ghi liên tiếp mà đối phương không ghi được điểm nào.' },
          { label: 'Time leading', h: fl.timeLeading ? mm(fl.timeLeading.home) : '–', a: fl.timeLeading ? mm(fl.timeLeading.away) : '–', hv: fl.timeLeading?.home, av: fl.timeLeading?.away },
          { label: `Lead changes: ${fl.leadChanges}`, h: '', a: '', hv: null },
          { label: `Times tied: ${fl.timesTied}`, h: '', a: '', hv: null },
        ])}
        {section('Ném rổ', [
          { label: 'FG', h: `${L.home.fgm}/${L.home.fga} · ${pct(L.home.fgm, L.home.fga)}`, a: `${L.away.fgm}/${L.away.fga} · ${pct(L.away.fgm, L.away.fga)}`, hv: L.home.fga ? L.home.fgm / L.home.fga : null, av: L.away.fga ? L.away.fgm / L.away.fga : null },
          { label: '2PT', h: `${L.home.p2m}/${L.home.p2a} · ${pct(L.home.p2m, L.home.p2a)}`, a: `${L.away.p2m}/${L.away.p2a} · ${pct(L.away.p2m, L.away.p2a)}`, hv: L.home.p2a ? L.home.p2m / L.home.p2a : null, av: L.away.p2a ? L.away.p2m / L.away.p2a : null },
          { label: '3PT', h: `${L.home.p3m}/${L.home.p3a} · ${pct(L.home.p3m, L.home.p3a)}`, a: `${L.away.p3m}/${L.away.p3a} · ${pct(L.away.p3m, L.away.p3a)}`, hv: L.home.p3a ? L.home.p3m / L.home.p3a : null, av: L.away.p3a ? L.away.p3m / L.away.p3a : null },
          { label: 'FT', h: `${L.home.ftm}/${L.home.fta} · ${pct(L.home.ftm, L.home.fta)}`, a: `${L.away.ftm}/${L.away.fta} · ${pct(L.away.ftm, L.away.fta)}`, hv: L.home.fta ? L.home.ftm / L.home.fta : null, av: L.away.fta ? L.away.ftm / L.away.fta : null },
          { label: 'eFG%', h: p1(adv.home.efg), a: p1(adv.away.efg), hv: adv.home.efg, av: adv.away.efg, note: 'FG% có tính thêm giá trị của cú 3 điểm: (FGM + 0.5 × 3PM) / FGA.' },
          { label: 'Assisted FGM', h: `${assisted('home')}/${madeFG('home').length}`, a: `${assisted('away')}/${madeFG('away').length}`, hv: madeFG('home').length ? assisted('home') / madeFG('home').length : null, av: madeFG('away').length ? assisted('away') / madeFG('away').length : null, note: 'Số cú ghi điểm có người kiến tạo / tổng cú ghi điểm (không tính ném phạt).' },
          { label: 'TS%', h: p1(adv.home.ts), a: p1(adv.away.ts), hv: adv.home.ts, av: adv.away.ts, note: 'Hiệu quả ghi điểm tính cả ném phạt: PTS / (2 × (FGA + 0.44 × FTA)).' },
        ])}
        {section('Four Factors', [
          { label: 'eFG%', h: p1(adv.home.efg), a: p1(adv.away.efg), hv: adv.home.efg, av: adv.away.efg },
          { label: 'TOV%', h: p1(adv.home.tovPct), a: p1(adv.away.tovPct), hv: adv.home.tovPct, av: adv.away.tovPct, lower: true, note: 'Tỉ lệ lượt tấn công kết thúc bằng mất bóng (càng thấp càng tốt).' },
          { label: 'OREB%', h: p1(adv.home.orebPct), a: p1(adv.away.orebPct), hv: adv.home.orebPct, av: adv.away.orebPct, note: 'Tỉ lệ giành được rebound tấn công: OREB / (OREB + DREB đối phương).' },
          { label: 'FTA / FGA', h: n1(adv.home.ftRate), a: n1(adv.away.ftRate), hv: adv.home.ftRate, av: adv.away.ftRate, note: 'Số lần ném phạt trên mỗi cú ném rổ: đo khả năng kiếm lỗi.' },
        ])}
        {section('Nhịp độ & hiệu quả', [
          { label: 'Possessions', h: n1(adv.home.poss), a: n1(adv.away.poss), hv: null, note: 'Ước tính: FGA − OREB + TOV + 0.44 × FTA.' },
          { label: 'Pts / 100 poss', h: n1(adv.home.ortg), a: n1(adv.away.ortg), hv: adv.home.ortg, av: adv.away.ortg },
          { label: 'AST / TO', h: n1(adv.home.astTo), a: n1(adv.away.astTo), hv: adv.home.astTo, av: adv.away.astTo },
          { label: 'AST', h: L.home.ast, a: L.away.ast },
        ])}
        {section('Bóng & lỗi', [
          { label: 'REB (O / D)', h: `${L.home.reb} (${L.home.oreb}/${L.home.dreb})`, a: `${L.away.reb} (${L.away.oreb}/${L.away.dreb})`, hv: L.home.reb, av: L.away.reb },
          { label: 'Team rebounds', h: adv.home.teamReb, a: adv.away.teamReb, hv: null },
          { label: 'Turnovers', h: L.home.tov, a: L.away.tov, lower: true },
          { label: 'Team turnovers', h: adv.home.teamTov, a: adv.away.teamTov, hv: null },
          { label: 'STL', h: L.home.stl, a: L.away.stl },
          { label: 'BLK', h: L.home.blk, a: L.away.blk },
          { label: 'PF', h: L.home.pf, a: L.away.pf, lower: true },
          { label: 'Fouls drawn', h: fd('home'), a: fd('away'), note: 'Số lần cầu thủ của đội bị phạm lỗi (đã chọn người bị phạm lỗi khi ghi).' },
          { label: 'Timeouts', h: `${tmo('home')} · còn ${Math.max(0, timeouts(stats, 'home', period).max - timeouts(stats, 'home', period).used)}`, a: `${tmo('away')} · còn ${Math.max(0, timeouts(stats, 'away', period).max - timeouts(stats, 'away', period).used)}`, hv: null },
        ])}
      </div>

      <div className="an-grid two">
        {(['home', 'away'] as TeamSide[]).map((s) => (
          <div key={s} className="card stack an-sec">
            <b>Hiệu quả cao nhất (EFF) · {name(s)}</b>
            {leaders(s).length === 0 ? <div className="muted small-note">Chưa có dữ liệu.</div> : leaders(s).map(({ p, l }) => (
              <div key={p.id} className="an-leader">
                <span className="an-big">{eff(l)}</span>
                <span className="grow"><b>{start.has(p.id) ? '*' : ''}#{p.number} {p.name}</b><br /><span className="muted small-note">{l.pts} PTS · {l.reb} REB · {l.ast} AST · {l.stl} STL · {l.tov} TOV · {l.fgm}/{l.fga} FG</span></span>
              </div>
            ))}
          </div>
        ))}
        {units('home')}
        {units('away')}
      </div>
      <div className="an-shots">
        {(['home', 'away'] as TeamSide[]).map((s) => {
          const shots = stats.filter((e) => e.side === s && e.shotX != null && e.shotY != null && ['2PM', '2PX', '3PM', '3PX'].includes(e.type))
          const z = zoneStats(stats.filter((e) => e.side === s))
          return (
            <div key={'sc' + s} className="card stack an-sec">
              <b>Shot chart · {name(s)}</b>
              {shots.length === 0 ? <div className="muted small-note">Chưa có cú ném nào được chọn vị trí. Chạm lên sân nhỏ ở tab Record trước khi bấm cú ném.</div> : (
                <div className="an-shot">
                  <Court shots={shots.map((e) => ({ id: e.id, x: e.shotX!, y: e.shotY!, made: e.type.endsWith('M'), color: s === 'home' ? 'var(--accent)' : '#9aa0ff', title: `${byId.get(e.gamePlayerId ?? '') ? '#' + byId.get(e.gamePlayerId ?? '')!.number : ''} ${e.type} ${periodLabel(e.period)}` }))} />
                  <table className="an-units">
                    <thead><tr><th>Vùng</th><th>FG</th><th>%</th></tr></thead>
                    <tbody>{(Object.keys(z) as Zone[]).map((k) => <tr key={k}><td style={{ textAlign: 'left' }}>{ZONE_LABEL[k]}</td><td>{z[k].m}/{z[k].a}</td><td>{pct(z[k].m, z[k].a)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="an-grid two">
        {(['home', 'away'] as TeamSide[]).map((s) => {
          const pairs = new Map<string, number>()
          for (const e of madeFG(s)) { const a = ast.get(e.id); if (a && e.gamePlayerId) pairs.set(`${a}>${e.gamePlayerId}`, (pairs.get(`${a}>${e.gamePlayerId}`) ?? 0) + 1) }
          const list = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
          return (
            <div key={'as' + s} className="card stack an-sec">
              <b>Ai kiến tạo cho ai · {name(s)}</b>
              {list.length === 0 ? <div className="muted small-note">Chưa có kiến tạo gắn với cú ghi điểm.</div> : list.map(([k, n]) => {
                const [a, b] = k.split('>').map((id) => byId.get(id))
                return <div key={k} className="an-pair"><span>#{a?.number} {a?.name}</span><span className="muted">→</span><span>#{b?.number} {b?.name}</span><b className="grow" style={{ textAlign: 'right' }}>{n}</b></div>
              })}
            </div>
          )
        })}
      </div>

      <div className="muted small-note">
        * Rê chuột lên dấu sao để xem cách tính. "Points from turnovers" và "Second chance" suy ra từ thứ tự các pha: ghi đủ mọi rebound (bóng ra ngoài thì chọn TEAM) và mọi lần mất bóng thì số liệu mới đúng.
        Tên các chỉ số giữ theo thuật ngữ FIBA / quốc tế.
      </div>
    </div>
  )
}
