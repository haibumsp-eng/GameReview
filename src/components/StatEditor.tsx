import { useEffect, useState } from 'react'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'
import { STAT_LABEL, periodLabel } from '../lib/boxscore'
import { mmss } from '../lib/minutes'
import type { StatPatch } from '../store'
import { Court } from './Court'
import { zoneOf, isThreeZone, type TovInfo } from '../lib/analytics'

const SHOTS: StatType[] = ['2PM', '2PX', '3PM', '3PX']
const TEAM_OK: StatType[] = ['OREB', 'DREB', 'TOV', 'PFT']
const DRAWN_OK: StatType[] = ['PF', 'PFS', 'PFU', 'PFD']
const TYPES: { t: StatType; short: string; group: string }[] = [
  { t: '2PM', short: '2PT ✓', group: 'Ném' }, { t: '2PX', short: '2PT ✗', group: 'Ném' }, { t: '3PM', short: '3PT ✓', group: 'Ném' }, { t: '3PX', short: '3PT ✗', group: 'Ném' },
  { t: 'FTM', short: 'FT ✓', group: 'Ném' }, { t: 'FTX', short: 'FT ✗', group: 'Ném' },
  { t: 'OREB', short: 'OREB', group: 'Khác' }, { t: 'DREB', short: 'DREB', group: 'Khác' }, { t: 'AST', short: 'AST', group: 'Khác' },
  { t: 'STL', short: 'STL', group: 'Khác' }, { t: 'BLK', short: 'BLK', group: 'Khác' }, { t: 'TOV', short: 'TOV', group: 'Khác' },
  { t: 'PF', short: 'PF', group: 'Lỗi' }, { t: 'PFS', short: 'SF', group: 'Lỗi' }, { t: 'PFT', short: 'TF', group: 'Lỗi' }, { t: 'PFU', short: 'UF', group: 'Lỗi' }, { t: 'PFD', short: 'DF', group: 'Lỗi' },
]

/**
 * Sửa một pha ngay trong Play-by-play: đổi loại pha, cầu thủ (kể cả sang đội kia), cờ paint / fast break,
 * vị trí ném, người bị phạm lỗi, hiệp và giờ. Mỗi lần bấm là áp dụng ngay (xem lại kết quả ở dòng phía trên).
 */
export function StatEditor(props: {
  e: StatEvent
  players: GamePlayer[]
  onCourt: Set<string>
  homeName: string
  awayName: string
  update: (patch: StatPatch) => void
  remove: () => void
  close: () => void
  say: (msg: string) => void
  /** Chỉ có với pha TOV: loại mất bóng và người cướp bóng. */
  tov?: { info: TovInfo | undefined; setKind: (k: 'self' | 'stolen') => void; setStealer: (pid: string | null) => void }
}) {
  const { e, players, onCourt } = props
  const [clock, setClock] = useState(e.clockS != null ? mmss(e.clockS) : '')
  const [showCourt, setShowCourt] = useState(false)
  useEffect(() => { setClock(e.clockS != null ? mmss(e.clockS) : '') }, [e.id, e.clockS])
  const shot = SHOTS.includes(e.type)
  const isTeam = !e.gamePlayerId
  const name = (s: TeamSide) => (s === 'home' ? props.homeName : props.awayName)

  const setType = (t: StatType) => {
    if (t === e.type) return
    if (isTeam && !TEAM_OK.includes(t)) return props.say('Pha của TEAM chỉ đổi được sang OREB, DREB, TOV, TF. Muốn loại khác, chọn một cầu thủ trước.')
    const p: StatPatch = { type: t }
    if (!SHOTS.includes(t)) Object.assign(p, { paint: false, fastBreak: false, shotX: null, shotY: null })
    else if (!t.startsWith('2')) Object.assign(p, { paint: false })
    if (!DRAWN_OK.includes(t)) p.drawnBy = null
    props.update(p)
  }
  const setPlayer = (pl: GamePlayer) => {
    if (pl.id === e.gamePlayerId) return
    const p: StatPatch = { gamePlayerId: pl.id, side: pl.side }
    // Người bị phạm lỗi phải thuộc đội đối phương của người mới.
    if (e.drawnBy) { const d = players.find((x) => x.id === e.drawnBy); if (d && d.side === pl.side) p.drawnBy = null }
    props.update(p)
  }
  const setTeam = (s: TeamSide) => {
    if (!TEAM_OK.includes(e.type)) return props.say('Loại pha này phải gắn với một cầu thủ.')
    props.update({ gamePlayerId: null, side: s, drawnBy: null })
  }
  const saveClock = () => {
    const m = clock.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) { setClock(e.clockS != null ? mmss(e.clockS) : ''); return props.say('Giờ nhập dạng 7:32') }
    const v = +m[1] * 60 + +m[2]
    if (v !== Math.round(e.clockS ?? -1)) props.update({ clockS: v })
  }
  const opp: TeamSide = e.side === 'home' ? 'away' : 'home'
  const oppPlayers = players.filter((x) => x.side === opp).sort((a, b) => a.number - b.number)

  const roster = (s: TeamSide) => {
    const list = players.filter((x) => x.side === s).sort((a, b) => Number(onCourt.has(b.id)) - Number(onCourt.has(a.id)) || a.number - b.number)
    return (
      <div className="se-group">
        <span className="se-lbl"><i className={`st-dot ${s}`} /> {name(s)}</span>
        {list.map((x) => (
          <button key={x.id} className={`se-chip ${e.gamePlayerId === x.id ? 'on' : ''} ${onCourt.has(x.id) ? '' : 'bench'}`} title={`${x.name}${onCourt.has(x.id) ? '' : ' (dự bị)'}`} onClick={() => setPlayer(x)}>{x.number}</button>
        ))}
        <button className={`se-chip team ${isTeam && e.side === s ? 'on' : ''}`} title="Pha của TEAM (không gắn cầu thủ)" onClick={() => setTeam(s)}>TEAM</button>
      </div>
    )
  }

  return (
    <div className="se" onClick={(ev) => ev.stopPropagation()}>
      <div className="se-row">
        <span className="se-lbl">Loại pha</span>
        <div className="se-chips">
          {TYPES.map((x) => <button key={x.t} className={`se-chip type ${e.type === x.t ? 'on' : ''}`} title={STAT_LABEL[x.t]} onClick={() => setType(x.t)}>{x.short}</button>)}
        </div>
      </div>
      <div className="se-row">
        <span className="se-lbl">Cầu thủ</span>
        <div className="se-players">{roster('home')}{roster('away')}</div>
      </div>
      {props.tov && (
        <div className="se-row">
          <span className="se-lbl">Loại mất bóng</span>
          <div className="se-chips">
            <button className={`se-chip type ${props.tov.info?.kind !== 'stolen' ? 'on' : ''}`} onClick={() => props.tov!.setKind('self')}>Tự mất bóng</button>
            <button className={`se-chip type ${props.tov.info?.kind === 'stolen' ? 'on' : ''}`} onClick={() => props.tov!.setKind('stolen')}>Bị steal</button>
          </div>
          {props.tov.info?.kind === 'stolen' && (
            <div className="se-chips">
              <span className="se-lbl">Ai cướp bóng</span>
              {oppPlayers.map((x) => <button key={x.id} className={`se-chip ${props.tov!.info?.stealerId === x.id ? 'on' : ''} ${onCourt.has(x.id) ? '' : 'bench'}`} title={x.name} onClick={() => props.tov!.setStealer(props.tov!.info?.stealerId === x.id ? null : x.id)}>{x.number}</button>)}
            </div>
          )}
        </div>
      )}
      {shot && (
        <div className="se-row">
          <span className="se-lbl">Cú ném</span>
          <div className="se-chips">
            {e.type.startsWith('2') && <button className={`se-chip type ${e.paint ? 'on' : ''}`} onClick={() => props.update({ paint: !e.paint })}>🎯 Trong paint</button>}
            <button className={`se-chip type ${e.fastBreak ? 'on' : ''}`} onClick={() => props.update({ fastBreak: !e.fastBreak })}>⚡ Fast break</button>
            <button className="se-chip type" onClick={() => setShowCourt(!showCourt)}>{e.shotX != null ? '📍 Sửa vị trí' : '📍 Thêm vị trí'}</button>
            {e.shotX != null && <button className="se-chip type" onClick={() => props.update({ shotX: null, shotY: null })}>Bỏ vị trí</button>}
          </div>
          {showCourt && (
            <div className="se-court">
              <Court pick={e.shotX != null && e.shotY != null ? { x: e.shotX, y: e.shotY } : null} onPick={(x, y) => {
                const z = zoneOf(x, y)
                const p: StatPatch = { shotX: x, shotY: y }
                if (e.type.startsWith('2')) p.paint = z === 'paint' || e.paint === true
                props.update(p)
                if (e.type.startsWith('2') && isThreeZone(z)) props.say('Lưu ý: vị trí nằm ngoài vạch 3 điểm mà pha ghi là 2PT')
              }} />
            </div>
          )}
        </div>
      )}
      {DRAWN_OK.includes(e.type) && !isTeam && (
        <div className="se-row">
          <span className="se-lbl">Ai bị phạm lỗi</span>
          <div className="se-chips">
            {oppPlayers.map((x) => <button key={x.id} className={`se-chip ${e.drawnBy === x.id ? 'on' : ''} ${onCourt.has(x.id) ? '' : 'bench'}`} title={x.name} onClick={() => props.update({ drawnBy: e.drawnBy === x.id ? null : x.id })}>{x.number}</button>)}
          </div>
        </div>
      )}
      <div className="se-row se-foot">
        <label className="se-time">Hiệp
          <select value={e.period} onChange={(ev) => props.update({ period: +ev.target.value })}>
            {Array.from({ length: Math.max(8, e.period) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}
          </select>
        </label>
        <label className="se-time">Giờ
          <input value={clock} placeholder="7:32" inputMode="numeric" onChange={(ev) => setClock(ev.target.value)} onBlur={saveClock} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }} />
        </label>
        <span className="grow" />
        <button className="btn sm danger" onClick={props.remove}>Xoá pha</button>
        <button className="btn sm primary" onClick={props.close}>Xong</button>
      </div>
    </div>
  )
}
