import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, videosOf, toast } from '../store'
import { yt } from '../youtube'
import { fmt } from '../util'
import { seekVideo } from '../nav'
import { lineOf, periodLabel, STAT_LABEL } from '../lib/boxscore'
import type { GamePlayer, StatType, TeamSide } from '../types'
import { Panel } from './Panel'
import { BoxScoreModal } from './BoxScore'

const ACTIONS: { type: StatType; label: string; tone?: 'made' | 'miss' }[] = [
  { type: '2PM', label: '2Đ ✓', tone: 'made' }, { type: '2PX', label: '2Đ ✗', tone: 'miss' },
  { type: '3PM', label: '3Đ ✓', tone: 'made' }, { type: '3PX', label: '3Đ ✗', tone: 'miss' },
  { type: 'FTM', label: 'NP ✓', tone: 'made' }, { type: 'FTX', label: 'NP ✗', tone: 'miss' },
  { type: 'OREB', label: 'BB tấn công' }, { type: 'DREB', label: 'BB phòng thủ' },
  { type: 'AST', label: 'Kiến tạo' }, { type: 'STL', label: 'Cướp bóng' },
  { type: 'BLK', label: 'Chắn bóng' }, { type: 'TOV', label: 'Mất bóng' }, { type: 'PF', label: 'Phạm lỗi' },
]

/** Bàn bấm thống kê 2 đội: chọn cầu thủ → bấm hành động. Mỗi pha gắn thời điểm trong video (nếu có). */
export function StatsPanel() {
  const { gameId, videoId, squadId } = useUi(useShallow((s) => ({ gameId: s.gameId, videoId: s.videoId, squadId: s.squadId })))
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const squad = useData((s) => s.squads.find((x) => x.id === squadId))
  const { gamePlayers, stats, players, setTeamNames, addGamePlayers, removeGamePlayer, addStat, removeStat } = useData()
  const [sel, setSel] = useState<GamePlayer | null>(null)
  const [periodOverride, setPeriodOverride] = useState<number | null>(null)
  const [showBox, setShowBox] = useState(false)
  const [paste, setPaste] = useState<{ side: TeamSide; text: string } | null>(null)

  if (!game) return <Panel title="Thống kê"><div className="placeholder small">Mở một trận để ghi thống kê.</div></Panel>

  const videos = videosOf(gameId)
  const autoPeriod = Math.max(1, videos.findIndex((v) => v.id === videoId) + 1)
  const period = periodOverride ?? autoPeriod
  const homeName = game.homeName || squad?.name || 'Đội nhà'
  const awayName = game.awayName || 'Đội khách'
  const roster = (side: TeamSide) => gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
  const score = (side: TeamSide) => lineOf(stats.filter((e) => e.side === side)).pts
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))

  const record = (type: StatType) => {
    if (!sel) return toast('Chọn cầu thủ trước (bấm số áo)')
    const hasVideo = !!videoId && yt.ready()
    addStat({ gameId: game.id, side: sel.side, gamePlayerId: sel.id, type, period, videoId: hasVideo ? videoId : null, videoT: hasVideo ? yt.time() : null })
    toast(`#${sel.number} ${sel.name}: ${STAT_LABEL[type]}`)
    setSel(null)
  }
  const undo = () => { const last = [...stats].sort((a, b) => b.createdAt - a.createdAt)[0]; if (last) removeStat(last.id) }
  const rename = (side: TeamSide) => {
    const n = prompt(side === 'home' ? 'Tên đội nhà' : 'Tên đội khách', side === 'home' ? homeName : awayName)?.trim()
    if (n) setTeamNames(game.id, side === 'home' ? n : homeName, side === 'away' ? n : awayName)
  }
  const importSquad = () => addGamePlayers(game.id, 'home',
    players.filter((p) => p.squadId === squadId).map((p) => ({ number: p.number, name: p.name, playerId: p.id })))
  const savePaste = () => {
    if (!paste) return
    const have = new Set(roster(paste.side).map((p) => p.number))
    const list = paste.text.split('\n').map((l) => l.trim().match(/^#?(\d{1,3})\s*[\t,;.\-–:]*\s*(.*)$/)).filter(Boolean)
      .map((m) => ({ number: +m![1], name: m![2].trim() || `Số ${m![1]}` })).filter((p) => !have.has(p.number))
    if (list.length) addGamePlayers(game.id, paste.side, list)
    setPaste(null)
  }

  const team = (side: TeamSide) => (
    <div className={`st-team ${side}`}>
      <div className="st-team-head">
        <button className="st-name" title="Bấm để đổi tên đội" onClick={() => rename(side)}>{side === 'home' ? homeName : awayName}</button>
        <span className="st-score">{score(side)}</span>
      </div>
      <div className="chips">
        {roster(side).map((p) => (
          <button key={p.id} className={`chip st-chip ${sel?.id === p.id ? 'on' : ''}`} title={p.name}
            onClick={() => setSel(sel?.id === p.id ? null : p)}
            onContextMenu={(e) => { e.preventDefault(); if (confirm(`Xoá #${p.number} ${p.name} khỏi trận (và các pha của người này)?`)) removeGamePlayer(p.id) }}>
            <b>{p.number}</b>{p.name.split(' ').slice(-1)[0]}
          </button>
        ))}
        {side === 'home' && roster('home').length === 0 && players.some((p) => p.squadId === squadId) && (
          <button className="btn sm" onClick={importSquad}>Lấy cầu thủ của tuyến</button>
        )}
        <button className="btn sm ghost" onClick={() => setPaste({ side, text: '' })}>+ Thêm</button>
      </div>
    </div>
  )

  return (
    <Panel title="Thống kê" actions={<button className="btn sm primary" onClick={() => setShowBox(true)}>📊 Box score</button>}>
      <div className="row">
        <span className="muted small-note">Hiệp</span>
        <select style={{ width: 120 }} value={period} onChange={(e) => setPeriodOverride(+e.target.value)}>
          {Array.from({ length: Math.max(4, videos.length, period) + 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}
        </select>
        {periodOverride != null && <button className="btn sm ghost" onClick={() => setPeriodOverride(null)}>Theo video</button>}
      </div>

      {team('home')}
      {team('away')}

      {paste && (
        <div className="card stack">
          <label className="field-label">Thêm cầu thủ {paste.side === 'home' ? homeName : awayName}: mỗi dòng “số tên”</label>
          <textarea rows={4} autoFocus placeholder={'4 Minh\n7 Nam\n(dán được từ Excel)'} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
          <div className="row"><button className="btn" onClick={() => setPaste(null)}>Huỷ</button><button className="btn primary grow-btn" onClick={savePaste}>Thêm</button></div>
        </div>
      )}

      <div className={`st-pad ${sel ? '' : 'idle'}`}>
        <div className="st-sel">{sel ? <>Đang chọn <b>#{sel.number} {sel.name}</b> ({sel.side === 'home' ? homeName : awayName})</> : 'Chọn cầu thủ, rồi bấm hành động'}</div>
        <div className="st-actions">
          {ACTIONS.map((a) => <button key={a.type} className={`btn st-act ${a.tone ?? ''}`} onClick={() => record(a.type)}>{a.label}</button>)}
        </div>
      </div>

      <div className="row">
        <span className="field-label grow">Diễn biến ({stats.length})</span>
        <button className="btn sm ghost" disabled={!stats.length} onClick={undo}>↶ Hoàn tác</button>
      </div>
      <ul className="list st-log">
        {[...stats].sort((a, b) => b.createdAt - a.createdAt).slice(0, 40).map((e) => {
          const p = e.gamePlayerId ? byId.get(e.gamePlayerId) : undefined
          return (
            <li key={e.id} className="item" onClick={() => e.videoId && e.videoT != null && seekVideo(e.videoId, Math.max(0, e.videoT - 3))}>
              <span className={`st-dot ${e.side}`} />
              <span className="grow"><span className="muted">{periodLabel(e.period)}{e.videoT != null ? ` · ${fmt(e.videoT)}` : ''}</span> <b>#{p?.number} {p?.name}</b> {STAT_LABEL[e.type]}</span>
              <button className="icon-btn" onClick={(ev) => { ev.stopPropagation(); removeStat(e.id) }}>×</button>
            </li>
          )
        })}
      </ul>
      {showBox && <BoxScoreModal onClose={() => setShowBox(false)} />}
    </Panel>
  )
}
