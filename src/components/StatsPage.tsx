import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, selectGame, myOrgRole, toast } from '../store'
import { isFoul, lineOf, periodLabel, STAT_LABEL } from '../lib/boxscore'
import { clockNow, mmss, onCourt, periodLength, secondsPlayed } from '../lib/minutes'
import type { GamePlayer, StatType, TeamSide } from '../types'
import { BoxScoreView } from './BoxScore'
import { PlayerPanel } from './PlayerPanel'
import { Gutter, SplitV } from './Gutter'
import { useLayout, clamp } from '../layout'
import { RemoteModal } from './Remote'
import { yt } from '../youtube'
import { seekVideo } from '../nav'
import { confirmDialog, promptDialog, dialogOpen } from '../lib/dialog'
import { VoicePanel, type VoiceStamp } from './VoicePanel'
import type { VoiceItem } from '../voice/parse'

const ACTIONS: { type: StatType; label: string; pts?: string; tone?: 'made' | 'miss' }[] = [
  { type: '2PM', label: '2PT', pts: '+2', tone: 'made' }, { type: '2PX', label: '2PT', pts: 'miss', tone: 'miss' },
  { type: '3PM', label: '3PT', pts: '+3', tone: 'made' }, { type: '3PX', label: '3PT', pts: 'miss', tone: 'miss' },
  { type: 'FTM', label: 'FT', pts: '+1', tone: 'made' }, { type: 'FTX', label: 'FT', pts: 'miss', tone: 'miss' },
  { type: 'OREB', label: 'OREB' }, { type: 'DREB', label: 'DREB' }, { type: 'AST', label: 'AST' },
  { type: 'STL', label: 'STL' }, { type: 'BLK', label: 'BLK' }, { type: 'TOV', label: 'TOV' }, { type: 'PF', label: 'PF' }, { type: 'PFS', label: 'SF' },
]

/** Trang Live Stats riêng: ghi thống kê 2 đội (dùng cho trận của đội hoặc giải đấu), không cần video. */
export function StatsPage() {
  const { orgId, squadId, gameId, videoId, set } = useUi(useShallow((s) => ({ orgId: s.orgId, squadId: s.squadId, gameId: s.gameId, videoId: s.videoId, set: s.set })))
  const L = useLayout()
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [showVideo, setShowVideo] = useState(() => { try { return localStorage.getItem('gr-sp-video') !== 'off' } catch { return true } })
  const toggleVideo = () => { setShowVideo(!showVideo); try { localStorage.setItem('gr-sp-video', showVideo ? 'off' : 'on') } catch { /* bỏ qua */ } }
  const { squads, games, players, gamePlayers, stats, lineups, isSuper, addGame, setTeamNames, addGamePlayers, removeGamePlayer, addStat, removeStat, setClock, addLineup, removeLineup, setStatVideo } = useData()
  const [tab, setTab] = useState<'record' | 'box'>('record')
  const [sel, setSel] = useState<GamePlayer | null>(null)
  const [, tick] = useState(0)
  const [paste, setPaste] = useState<{ side: TeamSide; text: string } | null>(null)
  const [newGame, setNewGame] = useState<{ title: string; home: string; away: string; date: string; len: number } | null>(null)
  const orgSquads = squads.filter((s) => s.orgId === orgId)
  const squadGames = games.filter((g) => g.squadId === squadId)
  const game = games.find((g) => g.id === gameId)
  const squad = squads.find((s) => s.id === squadId)
  const canEdit = isSuper || myOrgRole(orgId) !== 'viewer'

  // Đổi trận thì bỏ chọn cầu thủ.
  useEffect(() => { setSel(null) }, [gameId])

  // Pha bấm từ điện thoại: nếu máy này đang mở video thì gắn giây video cho pha đó (để bấm vào xem lại được).
  const attached = useRef(new Set<string>())
  useEffect(() => {
    if (!showVideo || !videoId || !yt.ready()) return
    const now = Date.now()
    for (const e of stats) {
      if (!e.viaRemote || e.videoT != null || attached.current.has(e.id) || now - e.createdAt > 15000) continue
      attached.current.add(e.id)
      const lag = yt.playing() ? Math.min(10, Math.max(0, (now - e.createdAt) / 1000)) : 0
      setStatVideo(e.id, videoId, Math.max(0, yt.time() - lag))
    }
  }, [stats, showVideo, videoId, setStatVideo])

  // ---- Đồng hồ thi đấu ----
  const len = game?.periodLen ?? 600
  const period = game?.clockPeriod ?? 1
  const remaining = game ? clockNow(game) : 0
  const running = !!game?.clockRunning
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(iv)
  }, [running])
  // Hết giờ thì tự dừng đồng hồ.
  useEffect(() => {
    if (game && running && remaining <= 0) setClock(game.id, { clockRunning: false, clockRemaining: 0, clockStartedAt: null })
  })
  const toggleClock = () => {
    if (!game || !canEdit) return
    if (running) setClock(game.id, { clockRunning: false, clockRemaining: clockNow(game), clockStartedAt: null })
    else if (remaining > 0) setClock(game.id, { clockRunning: true, clockRemaining: remaining, clockStartedAt: Date.now() })
  }
  const goPeriod = (p: number) => {
    if (!game || p < 1) return
    setClock(game.id, { clockPeriod: p, clockRunning: false, clockRemaining: periodLength(p, len), clockStartedAt: null })
  }
  const editClock = async () => {
    if (!game || !canEdit) return
    const v = await promptDialog({ title: 'Chỉnh đồng hồ', label: `Thời gian còn lại của ${periodLabel(period)} (phút:giây)`, value: mmss(remaining), placeholder: '7:32', inputMode: 'numeric',
      validate: (x) => (/^\d{1,2}:\d{2}$/.test(x.trim()) ? null : 'Nhập theo dạng phút:giây, ví dụ 7:32') })
    const m = v?.match(/^(\d{1,2}):(\d{2})$/)
    if (m) setClock(game.id, { clockRemaining: Math.min(periodLength(period, len), +m[1] * 60 + +m[2]), clockStartedAt: running ? Date.now() : null })
  }
  // Phím tắt: Space = đồng hồ thi đấu; K = phát/dừng video; J / L = video lùi / tới 5 giây.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen()) return
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); toggleClock() }
      else if (k === 'k') yt.toggle()
      else if (k === 'j') yt.seek(yt.time() - 5)
      else if (k === 'l') yt.seek(yt.time() + 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // Bấm vào khung YouTube sẽ kéo bàn phím vào trong đó (Space lại thành dừng video): lấy lại ngay.
  useEffect(() => {
    const reclaim = () => { const el = document.activeElement; if (el instanceof HTMLIFrameElement) { el.blur(); window.focus() } }
    const onBlur = () => setTimeout(reclaim, 0)
    const iv = setInterval(reclaim, 100)
    window.addEventListener('blur', onBlur)
    return () => { clearInterval(iv); window.removeEventListener('blur', onBlur) }
  }, [])

  const homeName = game?.homeName || squad?.name || 'HOME'
  const awayName = game?.awayName || 'AWAY'
  const roster = (side: TeamSide) => gamePlayers.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
  const score = (side: TeamSide) => lineOf(stats.filter((e) => e.side === side)).pts
  const fouls = (side: TeamSide) => stats.filter((e) => e.side === side && isFoul(e.type) && e.period === period).length
  const byId = new Map(gamePlayers.map((p) => [p.id, p]))
  const court = onCourt(lineups)
  const secs = secondsPlayed(lineups, len, period, remaining)

  const sub = (p: GamePlayer) => {
    if (!game || !canEdit) return
    const isOn = court.has(p.id)
    if (!isOn && roster(p.side).filter((x) => court.has(x.id)).length >= 5) return toast('Đã đủ 5 người trên sân: cho một người ra trước')
    addLineup({ gameId: game.id, side: p.side, gamePlayerId: p.id, kind: isOn ? 'out' : 'in', period, clockS: remaining })
    if (isOn && sel?.id === p.id) setSel(null)
    toast(`${periodLabel(period)} ${mmss(remaining)} · #${p.number} ${p.name} ${isOn ? 'ra sân' : 'vào sân'}`)
  }

  const record = (type: StatType) => {
    if (!game) return
    if (!sel) return toast('Chưa chọn cầu thủ trên sân')
    // Đang xem video thì gắn đúng giây trong video để bấm vào pha là xem lại được.
    const onVideo = showVideo && !!videoId && yt.ready()
    addStat({ gameId: game.id, side: sel.side, gamePlayerId: sel.id, type, period, videoId: onVideo ? videoId : null, videoT: onVideo ? yt.time() : null, clockS: remaining })
    toast(`#${sel.number} ${sel.name} · ${STAT_LABEL[type]}`)
    setSel(null)
  }
  // Ghi các pha từ giọng nói. Giờ / giây video lấy lúc bắt đầu nói.
  const voiceStamp = (): VoiceStamp => {
    const onVideo = showVideo && !!videoId && yt.ready()
    return { period, clockS: game ? clockNow(game) : 0, videoId: onVideo ? videoId : null, videoT: onVideo ? yt.time() : null }
  }
  const voiceCommit = (items: VoiceItem[], st: VoiceStamp) => {
    if (!game) return 0
    let n = 0
    for (const it of items) {
      if (it.kind === 'stat' && !it.error && it.gamePlayerId && it.side) {
        addStat({ gameId: game.id, side: it.side, gamePlayerId: it.gamePlayerId, type: it.type, period: st.period, videoId: st.videoId, videoT: st.videoT, clockS: st.clockS })
        n++
      } else if (it.kind === 'clock') {
        const g = useData.getState().games.find((x) => x.id === game.id)
        if (!g) continue
        if (!it.run && g.clockRunning) setClock(g.id, { clockRunning: false, clockRemaining: st.period === (g.clockPeriod ?? 1) ? st.clockS : clockNow(g), clockStartedAt: null })
        if (it.run && !g.clockRunning && clockNow(g) > 0) setClock(g.id, { clockRunning: true, clockRemaining: clockNow(g), clockStartedAt: Date.now() })
      }
    }
    return n
  }
  const voicePlayers = useMemo(() => gamePlayers.map((p) => ({ id: p.id, side: p.side, number: p.number, on: court.has(p.id) })), [gamePlayers, lineups])

  const undo = () => {
    const ls = [...stats].sort((a, b) => b.createdAt - a.createdAt)[0]
    const ll = [...lineups].sort((a, b) => b.createdAt - a.createdAt)[0]
    if (ll && (!ls || ll.createdAt > ls.createdAt)) removeLineup(ll.id)
    else if (ls) removeStat(ls.id)
  }
  const rename = async (side: TeamSide) => {
    if (!game) return
    const n = await promptDialog({ title: side === 'home' ? 'Tên đội nhà (HOME)' : 'Tên đội khách (AWAY)', value: side === 'home' ? homeName : awayName,
      validate: (x) => (x.trim() ? null : 'Nhập tên đội') })
    if (n) setTeamNames(game.id, side === 'home' ? n : homeName, side === 'away' ? n : awayName)
  }
  const savePaste = () => {
    if (!paste || !game) return
    const have = new Set(roster(paste.side).map((p) => p.number))
    const list = paste.text.split('\n').map((l) => l.trim().match(/^#?(\d{1,3})\s*[\t,;.\-–:]*\s*(.*)$/)).filter(Boolean)
      .map((m) => ({ number: +m![1], name: m![2].trim() || `No ${m![1]}` })).filter((p) => !have.has(p.number))
    if (list.length) addGamePlayers(game.id, paste.side, list)
    setPaste(null)
  }
  const createGame = () => {
    if (!newGame || !squadId) return
    const { gameId: gid } = addGame({ squadId, title: newGame.title.trim() || `${newGame.home || 'HOME'} vs ${newGame.away || 'AWAY'}`, date: newGame.date }, [])
    setTeamNames(gid, newGame.home.trim(), newGame.away.trim())
    setTimeout(() => setClock(gid, { periodLen: newGame.len, clockPeriod: 1, clockRemaining: newGame.len, clockRunning: false, clockStartedAt: null }), 400)
    selectGame(gid); setNewGame(null)
  }

  // Shift + click: xoá cầu thủ. Chưa có pha nào thì xoá ngay; đã có thì hỏi lại một lần.
  const deletePlayer = async (p: GamePlayer) => {
    const n = stats.filter((e) => e.gamePlayerId === p.id).length + lineups.filter((e) => e.gamePlayerId === p.id).length
    if (n && !(await confirmDialog({ title: `Xoá #${p.number} ${p.name}?`, message: `${n} pha / lần thay người của cầu thủ này cũng bị xoá.`, okText: 'Xoá', danger: true }))) return
    if (sel?.id === p.id) setSel(null)
    removeGamePlayer(p.id)
    toast(`Đã xoá #${p.number} ${p.name}`)
  }
  const card = (p: GamePlayer) => {
    const pf = stats.filter((e) => e.gamePlayerId === p.id && isFoul(e.type)).length
    const isOn = court.has(p.id)
    return (
      <div key={p.id} className={`sp-player ${sel?.id === p.id ? 'on' : ''} ${pf >= 5 ? 'out' : ''} ${isOn ? '' : 'benched'}`}
        title={`#${p.number} ${p.name} · ${pf} PF · ${mmss(secs.get(p.id) ?? 0)} MIN`}
        onClick={(e) => { if (!canEdit) return; if (e.shiftKey) return deletePlayer(p); if (isOn) setSel(sel?.id === p.id ? null : p) }}>
        <span className="sp-no">{p.number}</span>
        <span className="sp-pname">{p.name}</span>
        {canEdit && <button className="sp-sub" title={court.has(p.id) ? 'Ra sân' : 'Vào sân'} onClick={(e) => { e.stopPropagation(); sub(p) }}>{court.has(p.id) ? '↓' : '↑'}</button>}
      </div>
    )
  }
  const team = (side: TeamSide) => {
    const on = roster(side).filter((p) => court.has(p.id))
    const bench = roster(side).filter((p) => !court.has(p.id))
    return (
      <div className={`sp-team ${side}`}>
        <div className="sp-team-head">
          <button className="sp-name" disabled={!canEdit} title="Bấm để đổi tên đội" onClick={() => rename(side)}>{side === 'home' ? homeName : awayName}</button>
          <span className="sp-fouls" title={`Team fouls ${periodLabel(period)}`}>TF {fouls(side)}</span>
        </div>
        <div className="sp-group-label">ON COURT <b>{on.length}/5</b></div>
        <div className="sp-roster">
          {on.map(card)}
        </div>
        <div className="sp-group-label">BENCH</div>
        <div className="sp-roster bench">
          {bench.map(card)}
          {canEdit && (
            <div className="row">
              {side === 'home' && roster('home').length === 0 && players.some((p) => p.squadId === squadId) && (
                <button className="btn sm" onClick={() => game && addGamePlayers(game.id, 'home', players.filter((p) => p.squadId === squadId).map((p) => ({ number: p.number, name: p.name, playerId: p.id })))}>
                  Lấy cầu thủ của tuyến
                </button>
              )}
              <button className="btn sm ghost" onClick={() => setPaste({ side, text: '' })}>+ Thêm cầu thủ</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const logEl = (
  <div className="sp-log">
    <div className="row">
      <b className="grow">Play-by-play ({stats.length + lineups.length})</b>
      <button className="btn sm" disabled={!(stats.length + lineups.length) || !canEdit} onClick={undo}>↶ Undo</button>
    </div>
    <ul className="list">
      {[...stats.map((e) => ({ at: e.createdAt, s: e, l: undefined })), ...lineups.map((e) => ({ at: e.createdAt, s: undefined, l: e }))]
        .sort((a, b) => b.at - a.at).map(({ s: e, l }) => {
          const ev = (e ?? l)!
          const p = byId.get((e ? e.gamePlayerId : l!.gamePlayerId) ?? '')
          const clock = e ? e.clockS : l!.clockS
          return (
            <li key={ev.id} className={`item ${l ? 'sp-subrow' : ''} ${e?.videoT != null ? 'seekable' : ''}`}
              title={e?.videoT != null ? 'Bấm để xem lại pha này' : undefined}
              onClick={() => { if (e?.videoId && e.videoT != null) { if (!showVideo) toggleVideo(); setTimeout(() => seekVideo(e.videoId!, Math.max(0, e.videoT! - 3), true), 50) } }}>
              <span className={`st-dot ${ev.side}`} />
              <span className="grow">
                <span className="muted">{periodLabel(ev.period)}{clock != null ? ` ${mmss(clock)}` : ''}</span> <b>#{p?.number} {p?.name}</b>{' '}
                {e ? STAT_LABEL[e.type] : l!.kind === 'in' ? 'SUB IN' : 'SUB OUT'}
              </span>
              {canEdit && <button className="icon-btn" onClick={() => (e ? removeStat(e.id) : removeLineup(l!.id))}>×</button>}
            </li>
          )
        })}
    </ul>
  </div>
  )

  const padBlock = (
        <div className={`sp-pad ${sel ? '' : 'idle'}`}>
      <div className="sp-sel">{sel ? <>#{sel.number} {sel.name} <span className="muted">· {sel.side === 'home' ? homeName : awayName}</span></> : '—'}</div>
          <div className="sp-actions">
            {ACTIONS.map((a) => (
              <button key={a.type} className={`sp-act ${a.tone ?? ''}`} disabled={!canEdit} onClick={() => record(a.type)}>
                <span>{a.label}</span>{a.pts && <small>{a.pts}</small>}
              </button>
            ))}
          </div>
        </div>
  )

  const underBlock = (
    <div className="sp-under">
              <div className="sp-score">
                <span className="sp-sname">{homeName}</span>
                <span className="sp-num home">{score('home')}</span>
                <div className="sp-clock">
                  <div className="sp-period">
                    <button className="icon-btn" disabled={period <= 1 || !canEdit} onClick={() => goPeriod(period - 1)}>‹</button>
                    <b>{periodLabel(period)}</b>
                    <button className="icon-btn" disabled={!canEdit} onClick={() => goPeriod(period + 1)}>›</button>
                  </div>
                  <button className={`sp-time ${running ? 'run' : ''}`} title="Bấm để chỉnh giờ" onClick={editClock}>{mmss(remaining)}</button>
                  <button className={`btn sm ${running ? '' : 'primary'}`} disabled={!canEdit || (!running && remaining <= 0)} onClick={toggleClock}>
                    {running ? '❚❚ Dừng' : '▶ Chạy'} <kbd>Space</kbd>
                  </button>
                </div>
                <span className="sp-num away">{score('away')}</span>
                <span className="sp-sname">{awayName}</span>
              </div>
              <div className="sp-deck">{team('home')}{padBlock}{team('away')}</div>
              {paste && (
                <div className="card stack">
                  <label className="field-label">Thêm cầu thủ {paste.side === 'home' ? homeName : awayName}: mỗi dòng “số tên”</label>
                  <textarea rows={5} autoFocus placeholder={'4 Minh\n7 Nam\n(dán được từ Excel)'} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
                  <div className="row"><button className="btn" onClick={() => setPaste(null)}>Huỷ</button><button className="btn primary grow-btn" onClick={savePaste}>Thêm</button></div>
                </div>
              )}
    </div>
  )

  return (
    <div className="sp">
      <div className="sp-bar">
        <select className="sp-select" value={squadId} onChange={(e) => { set({ squadId: e.target.value }); selectGame(null) }}>
          {orgSquads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="sp-select wide" value={gameId ?? ''} onChange={(e) => selectGame(e.target.value || null)}>
          <option value="">— Chọn trận —</option>
          {squadGames.map((g) => <option key={g.id} value={g.id}>{g.date ? `${g.date} · ` : ''}{g.title}</option>)}
        </select>
        {canEdit && <button className="btn primary" disabled={!squadId} onClick={() => setNewGame({ title: '', home: squad?.name ?? '', away: '', date: new Date().toISOString().slice(0, 10), len: 600 })}>+ Trận mới</button>}
        <span className="spacer" />
        {game && canEdit && <button className="btn sm" onClick={() => setRemoteOpen(true)}>📱 Điện thoại</button>}
        {game && (
          <button className="btn sm ghost" onClick={toggleVideo}>{showVideo ? 'Ẩn video' : 'Hiện video'}</button>
        )}
        {game && (
          <div className="seg-toggle sp-tabs">
            <button className={tab === 'record' ? 'on' : ''} onClick={() => setTab('record')}>Record</button>
            <button className={tab === 'box' ? 'on' : ''} onClick={() => setTab('box')}>Box score</button>
          </div>
        )}
      </div>

      {remoteOpen && game && <RemoteModal gameId={game.id} onClose={() => setRemoteOpen(false)} />}
      {newGame && (
        <div className="modal-back" onClick={() => setNewGame(null)}>
          <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
            <b>Trận mới (chỉ thống kê, không cần video)</b>
            <div className="org-form">
              <input placeholder="HOME (đội nhà)" value={newGame.home} onChange={(e) => setNewGame({ ...newGame, home: e.target.value })} />
              <input placeholder="AWAY (đội khách)" value={newGame.away} onChange={(e) => setNewGame({ ...newGame, away: e.target.value })} />
              <input placeholder="Tên trận (tuỳ chọn)" value={newGame.title} onChange={(e) => setNewGame({ ...newGame, title: e.target.value })} />
              <input type="date" value={newGame.date} onChange={(e) => setNewGame({ ...newGame, date: e.target.value })} />
              <select value={newGame.len} onChange={(e) => setNewGame({ ...newGame, len: +e.target.value })}>
                {[10, 8, 12, 6].map((m) => <option key={m} value={m * 60}>Mỗi hiệp {m} phút</option>)}
              </select>
            </div>
            <div className="row"><button className="btn" onClick={() => setNewGame(null)}>Huỷ</button><button className="btn primary grow-btn" onClick={createGame}>Tạo trận</button></div>
          </div>
        </div>
      )}

      {!game ? (
        <div className="placeholder">Chọn một trận ở trên, hoặc bấm <b>+ Trận mới</b> để thống kê một trận (kể cả trận của giải đấu).</div>
      ) : tab === 'box' ? (
        <div className="sp-box"><BoxScoreView editable={canEdit} onSeek={(vid, t) => { setTab('record'); if (!showVideo) toggleVideo(); setTimeout(() => seekVideo(vid, t, true), 50) }} /></div>
      ) : (
        <div className="sp-work">
          <div className="col center sp-main-col">
            {showVideo
              ? <SplitV frac={L.spSplit} setFrac={(f) => L.set({ spSplit: f })} top={<div className="sp-video"><PlayerPanel /></div>} bottom={underBlock} />
              : underBlock}
          </div>
          <Gutter dir="col" begin={() => L.spRight} move={(st, dx) => L.set({ spRight: clamp(st - dx, 220, 560) })} />
          <div className="col sp-col-right" style={{ width: L.spRight }}>
            {logEl}
            {game && <div className="sp-voice"><VoicePanel gameId={game.id} homeName={homeName} awayName={awayName} players={voicePlayers} canEdit={canEdit} stamp={voiceStamp} onCommit={voiceCommit} /></div>}
          </div>
        </div>
      )}
    </div>
  )
}
