import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, selectGame, myOrgRole, toast, isJetSquad, isJetGame } from '../store'
import { isFoul, lineOf, periodLabel, STAT_LABEL } from '../lib/boxscore'
import { clockNow, mmss, offCourtStats, onCourt, periodLength, secondsPlayed } from '../lib/minutes'
import type { GamePlayer, StatEvent, StatType, TeamSide } from '../types'
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
import { Analysis } from './Analysis'
import { BONUS_AT, foulStatus, isThreeZone, teamFouls, timeouts, turnoverInfo, zoneOf } from '../lib/analytics'
import { Court } from './Court'
import { ESheet } from './ESheet'
import { FtFlow, FOUL_KINDS, type FoulKind, type FtStart } from './FtFlow'
import { GameRosterModal } from './GameRoster'
import { StatEditor } from './StatEditor'
import { SubEditor, SubForm } from './SubEditor'

/** Khung video trong Live Stats: tạm tắt (bật lại = true). */
const VIDEO_ENABLED = false
const SHOT_TYPES: StatType[] = ['2PM', '2PX', '3PM', '3PX']
// Lỗi có người bị phạm (hỏi tiếp "ai bị phạm lỗi"). Lỗi kỹ thuật thì không.
const DRAWN_TYPES: StatType[] = ['PF', 'PFS', 'PFU', 'PFD']

const ACTIONS: { type: StatType; label: string; pts?: string; tone?: 'made' | 'miss'; tov?: 'self' | 'stolen' }[] = [
  { type: '2PM', label: '2PT', pts: '+2', tone: 'made' }, { type: '2PX', label: '2PT', pts: 'miss', tone: 'miss' },
  { type: '3PM', label: '3PT', pts: '+3', tone: 'made' }, { type: '3PX', label: '3PT', pts: 'miss', tone: 'miss' },
  { type: 'FTM', label: 'FT', pts: '+1', tone: 'made' }, { type: 'FTX', label: 'FT', pts: 'miss', tone: 'miss' },
  { type: 'OREB', label: 'OREB' }, { type: 'DREB', label: 'DREB' }, { type: 'AST', label: 'AST' },
  { type: 'STL', label: 'STL' }, { type: 'BLK', label: 'BLK' }, { type: 'TOV', label: 'TOV', pts: 'tự mất', tov: 'self' }, { type: 'TOV', label: 'TOV', pts: 'bị steal', tov: 'stolen' }, { type: 'PF', label: 'PF' }, { type: 'PFS', label: 'SF' },
  { type: 'PFT', label: 'TF', pts: 'technical' }, { type: 'PFU', label: 'UF', pts: 'unsport.' }, { type: 'PFD', label: 'DF', pts: 'disqualif.' },
]

/** Trang Live Stats riêng: ghi thống kê 2 đội (dùng cho trận của đội hoặc giải đấu), không cần video. */
export function StatsPage() {
  const { orgId, squadId, gameId, videoId, set } = useUi(useShallow((s) => ({ orgId: s.orgId, squadId: s.squadId, gameId: s.gameId, videoId: s.videoId, set: s.set })))
  const L = useLayout()
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState<TeamSide | null>(null)
  // Sửa pha: dòng Play-by-play đang mở trình sửa, và pha vừa ghi (hiện thanh sửa / hoàn tác nhanh).
  const [editId, setEditId] = useState<string | null>(null)
  const [lastId, setLastId] = useState<string | null>(null)
  const [subForm, setSubForm] = useState(false)
  const lastTimer = useRef<ReturnType<typeof setTimeout>>()
  const flashLast = (id: string) => { setLastId(id); clearTimeout(lastTimer.current); lastTimer.current = setTimeout(() => setLastId(null), 12000) }
  const [showVideoPref, setShowVideo] = useState(() => { try { return localStorage.getItem('gr-sp-video') !== 'off' } catch { return true } })
  const showVideo = VIDEO_ENABLED && showVideoPref
  const toggleVideo = () => { if (!VIDEO_ENABLED) return; setShowVideo(!showVideo); try { localStorage.setItem('gr-sp-video', showVideo ? 'off' : 'on') } catch { /* bỏ qua */ } }
  const { squads, games, players, gamePlayers, stats, lineups, isSuper, addGame, setTeamNames, removeGamePlayer, addStat, updateStat, removeStat, setClock, addLineup, updateLineup, removeLineup, setStatVideo } = useData()
  const [tab, setTab] = useState<'record' | 'box' | 'sheet' | 'analysis'>('record')
  // Cờ cho cú ném tiếp theo: trong paint / fast break. Tự tắt sau khi ghi.
  const [mods, setMods] = useState({ paint: false, fb: false })
  // Vị trí cú ném tiếp theo (chạm lên sân nhỏ). Trong paint thì tự bật cờ "Trong paint".
  const [loc, setLoc] = useState<{ x: number; y: number } | null>(null)
  // Hỏi tiếp sau một pha: ai bị phạm lỗi / ai kiến tạo.
  const [fu, setFu] = useState<{ kind: 'drawn' | 'assist' | 'steal'; eventId: string; side: TeamSide; exclude?: string } | null>(null)
  const [sel, setSel] = useState<GamePlayer | null>(null)
  // Bảng ném phạt mở sau lỗi dẫn tới ném phạt (lỗi khi ném rổ, kỹ thuật, không thể thể thao, truất quyền, lỗi cá nhân khi đã bonus).
  const [ftStart, setFtStart] = useState<FtStart | null>(null)
  const [, tick] = useState(0)
  const [newGame, setNewGame] = useState<{ title: string; home: string; away: string; date: string; len: number } | null>(null)
  // Giải JET là mục riêng: không lẫn vào tuyến đội / trận thường (trừ khi đang mở đúng trận JET đó).
  const orgSquads = squads.filter((s) => s.orgId === orgId && (!isJetSquad(s) || s.id === squadId))
  const squadGames = games.filter((g) => g.squadId === squadId && (!isJetGame(g, squads) || g.id === gameId))
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
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.altKey) return
      const k = e.key.toLowerCase()
      // Ctrl/Cmd + Z: hoàn tác pha / thay người vừa ghi.
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (canEdit) undo(); return }
      if (e.ctrlKey || e.metaKey) return
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
  const fouls = (side: TeamSide) => teamFouls(stats, side, period)
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

  const record = (type: StatType, tov?: 'self' | 'stolen') => {
    if (!game) return
    if (!sel) return toast('Chưa chọn cầu thủ trên sân')
    // Đang xem video thì gắn đúng giây trong video để bấm vào pha là xem lại được.
    const onVideo = showVideo && !!videoId && yt.ready()
    const shot = SHOT_TYPES.includes(type)
    const paint = shot && type.startsWith('2') && (mods.paint || (!!loc && zoneOf(loc.x, loc.y) === 'paint'))
    const id = addStat({
      gameId: game.id, side: sel.side, gamePlayerId: sel.id, type, period,
      videoId: onVideo ? videoId : null, videoT: onVideo ? yt.time() : null, clockS: remaining,
      paint, fastBreak: shot && mods.fb, shotX: shot && loc ? loc.x : null, shotY: shot && loc ? loc.y : null,
      tovKind: type === 'TOV' ? tov ?? null : null,
    })
    const tags = shot ? [type.startsWith('2') && paint ? 'trong paint' : '', mods.fb ? 'fast break' : '', loc ? 'có vị trí' : ''].filter(Boolean).join(', ') : ''
    if (shot && loc && type.startsWith('2') && isThreeZone(zoneOf(loc.x, loc.y))) toast('Lưu ý: vị trí chọn nằm ngoài vạch 3 điểm mà ghi 2PT')
    else toast(`#${sel.number} ${sel.name} · ${STAT_LABEL[type]}${tags ? ` (${tags})` : ''}`)
    if (shot) { setMods({ paint: false, fb: false }); setLoc(null) }
    // Lỗi dẫn tới ném phạt: mở bảng ném phạt (hỏi ai ném, từng quả vào / trượt, rebound).
    const foulFt = FOUL_KINDS.includes(type) && (type !== 'PF' || teamFouls(stats, sel.side, period) + 1 > BONUS_AT)
    if (foulFt) { setFtStart({ kind: type as FoulKind, foulId: id, foulerSide: sel.side }); setFu(null) }
    // Hỏi tiếp: lỗi → ai bị phạm lỗi; ghi điểm → ai kiến tạo.
    else if (sel && DRAWN_TYPES.includes(type)) setFu({ kind: 'drawn', eventId: id, side: sel.side === 'home' ? 'away' : 'home' })
    else if (sel && (type === '2PM' || type === '3PM')) setFu({ kind: 'assist', eventId: id, side: sel.side, exclude: sel.id })
    else if (type === 'TOV' && tov === 'stolen') setFu({ kind: 'steal', eventId: id, side: sel.side === 'home' ? 'away' : 'home' })
    else setFu(null)
    flashLast(id)
    setSel(null)
  }
  // Sửa loại mất bóng của một pha TOV trong Play-by-play.
  const setTovKind = (e: StatEvent, kind: 'self' | 'stolen') => {
    const info = tovInfo.get(e.id)
    if (kind === 'self') {
      updateStat(e.id, { tovKind: 'self', linkedId: null })
      if (info?.stealId) {
        updateStat(info.stealId, { linkedId: null }) // pha STL giữ nguyên nhưng không còn nối với TOV này
        toast('Pha STL của đối thủ vẫn được giữ lại. Nếu STL đó cũng nhầm, xoá nó ở Play-by-play.')
      }
    } else updateStat(e.id, { tovKind: 'stolen' })
  }
  const setStealer = (e: StatEvent, pid: string | null) => {
    if (!game) return
    const info = tovInfo.get(e.id)
    const opp: TeamSide = e.side === 'home' ? 'away' : 'home'
    if (info?.stealId) {
      if (pid) updateStat(info.stealId, { gamePlayerId: pid, side: opp, linkedId: e.id })
      else { removeStat(info.stealId); updateStat(e.id, { linkedId: null }) }
    } else if (pid) {
      const sid = addStat({ gameId: game.id, side: opp, gamePlayerId: pid, type: 'STL', period: e.period, videoId: e.videoId, videoT: e.videoT, clockS: e.clockS, linkedId: e.id })
      updateStat(e.id, { linkedId: sid, tovKind: 'stolen' })
    }
  }
  const answerFu = (playerId: string | null) => {
    if (!fu || !game) return setFu(null)
    const ev = stats.find((e) => e.id === fu.eventId)
    if (playerId && fu.kind === 'drawn') updateStat(fu.eventId, { drawnBy: playerId })
    if (playerId && fu.kind === 'steal' && ev) {
      // Ghi luôn pha STL của đối thủ và nối với pha mất bóng này.
      const sid = addStat({ gameId: game.id, side: fu.side, gamePlayerId: playerId, type: 'STL', period: ev.period, videoId: ev.videoId, videoT: ev.videoT, clockS: ev.clockS, linkedId: ev.id })
      updateStat(ev.id, { linkedId: sid, tovKind: 'stolen' })
      const p = byId.get(playerId); toast(`#${p?.number} ${p?.name} · STL`)
    }
    if (playerId && fu.kind === 'assist' && ev) {
      addStat({ gameId: game.id, side: fu.side, gamePlayerId: playerId, type: 'AST', period: ev.period, videoId: ev.videoId, videoT: ev.videoT, clockS: ev.clockS, linkedId: ev.id })
      const p = byId.get(playerId); toast(`#${p?.number} ${p?.name} · AST`)
    }
    setFu(null)
  }
  const timeout = (side: TeamSide) => {
    if (!game || !canEdit) return
    const t = timeouts(stats, side, period)
    if (t.used >= t.max) toast(`Lưu ý: ${side === 'home' ? homeName : awayName} đã dùng hết ${t.max} timeout của giai đoạn này`)
    if (running) setClock(game.id, { clockRunning: false, clockRemaining: clockNow(game), clockStartedAt: null })
    addStat({ gameId: game.id, side, gamePlayerId: null, type: 'TMO', period, videoId: null, videoT: null, clockS: clockNow(game) })
    toast(`${periodLabel(period)} ${mmss(clockNow(game))} · Timeout ${side === 'home' ? homeName : awayName} (đồng hồ đã dừng)`)
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
        flashLast(addStat({ gameId: game.id, side: it.side, gamePlayerId: it.gamePlayerId, type: it.type, period: st.period, videoId: st.videoId, videoT: st.videoT, clockS: st.clockS }))
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
    setLastId(null); setEditId(null)
  }
  const tovInfo = useMemo(() => turnoverInfo(stats), [stats])
  const suspicious = useMemo(() => offCourtStats(stats, lineups), [stats, lineups])
  const lastStat = lastId ? stats.find((e) => e.id === lastId) : undefined
  // Câu hỏi tiếp (ai bị phạm lỗi / ai kiến tạo) hết ý nghĩa nếu pha đó đã bị xoá hoặc đổi sang loại khác.
  useEffect(() => {
    if (!fu) return
    const ev = stats.find((e) => e.id === fu.eventId)
    const ok = ev && (fu.kind === 'assist' ? ev.type === '2PM' || ev.type === '3PM' : fu.kind === 'steal' ? ev.type === 'TOV' : DRAWN_TYPES.includes(ev.type))
    if (!ok) setFu(null)
  }, [stats, fu])
  const rename = async (side: TeamSide) => {
    if (!game) return
    const n = await promptDialog({ title: side === 'home' ? 'Tên đội nhà (HOME)' : 'Tên đội khách (AWAY)', value: side === 'home' ? homeName : awayName,
      validate: (x) => (x.trim() ? null : 'Nhập tên đội') })
    if (n) setTeamNames(game.id, side === 'home' ? n : homeName, side === 'away' ? n : awayName)
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
    const fs = foulStatus(stats, p.id)
    const pf = fs.total
    const isOn = court.has(p.id)
    const fTip = [fs.t ? `${fs.t} kỹ thuật` : '', fs.u ? `${fs.u} phản TTTT` : '', fs.d ? 'truất quyền' : ''].filter(Boolean).join(', ')
    return (
      <div key={p.id} className={`sp-player ${sel?.id === p.id ? 'on' : ''} ${fs.out ? 'out' : ''} ${isOn ? '' : 'benched'}`}
        title={`#${p.number} ${p.name} · ${pf} PF${fTip ? ` (${fTip})` : ''}${fs.out ? ' · PHẢI RỜI SÂN' : ''} · ${mmss(secs.get(p.id) ?? 0)} MIN`}
        onClick={(e) => { if (!canEdit) return; if (e.shiftKey) return deletePlayer(p); if (isOn) { setSel(sel?.id === p.id ? null : p) } }}>
        <span className="sp-no">{p.number}</span>
        <span className="sp-pname">{p.name}</span>
        {(pf >= 3 || fs.out) && <span className={`sp-pf f${fs.out ? 5 : Math.min(pf, 5)}`}>{fs.out ? 'DQ' : `${pf}F`}</span>}
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
          <span className="sp-team-meta">
            <span className={`sp-fouls ${fouls(side) >= BONUS_AT ? 'bonus' : ''}`} title={`Lỗi đồng đội ${period >= 4 ? 'Q4 + hiệp phụ' : periodLabel(period)}. Từ lỗi thứ ${BONUS_AT + 1}, đối phương được ném phạt.`}>
              TF {fouls(side)}{fouls(side) >= BONUS_AT && ' · BONUS'}
            </span>
            {(() => { const t = timeouts(stats, side, period); return (
              <button className={`sp-tmo ${t.used >= t.max ? 'out' : ''}`} disabled={!canEdit} title="Ghi timeout (tự dừng đồng hồ)" onClick={() => timeout(side)}>TO {t.used}/{t.max}</button>
            ) })()}
          </span>
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
              <button className={`btn sm ${roster(side).length === 0 ? 'primary' : ''}`} title="Ai có mặt trận này và mặc số áo nào" onClick={() => setRosterOpen(side)}>
                {roster(side).length === 0 ? (side === 'home' && players.some((p) => p.squadId === squadId) ? 'Lấy cầu thủ của tuyến' : '+ Nhập danh sách đội') : 'Danh sách trận / số áo'}
              </button>
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
      {canEdit && <button className={`btn sm ${subForm ? 'primary' : ''}`} title="Bổ sung một lần thay người đã quên ghi, ở giờ tuỳ chọn" onClick={() => setSubForm(!subForm)}>+ Thay người</button>}
      <button className="btn sm" disabled={!(stats.length + lineups.length) || !canEdit} title="Hoàn tác pha vừa ghi (Ctrl + Z)" onClick={undo}>↶ Undo</button>
    </div>
    {subForm && canEdit && (
      <SubForm players={gamePlayers} lineups={lineups} homeName={homeName} awayName={awayName} period={period} clockS={remaining}
        add={(side, kind, pid, per, clk) => addLineup({ gameId: game!.id, side, gamePlayerId: pid, kind, period: per, clockS: clk })}
        close={() => setSubForm(false)} say={toast} />
    )}
    {suspicious.size > 0 && <div className="sp-warn" title="Cầu thủ có pha nhưng không ở trên sân vào giờ đó. Thường do quên ghi một lần thay người.">⚠ {suspicious.size} pha của cầu thủ không ở trên sân lúc đó. Bấm + Thay người để bổ sung, hoặc ✎ để đổi cầu thủ.</div>}
    <ul className="list">
      {[...stats.map((e) => ({ at: e.createdAt, s: e, l: undefined })), ...lineups.map((e) => ({ at: e.createdAt, s: undefined, l: e }))]
        .sort((a, b) => { const x = (a.s ?? a.l)!, y = (b.s ?? b.l)!; return y.period - x.period || ((x.clockS ?? 1e9) - (y.clockS ?? 1e9)) || b.at - a.at }).map(({ s: e, l }) => {
          const ev = (e ?? l)!
          const p = byId.get((e ? e.gamePlayerId : l!.gamePlayerId) ?? '')
          const clock = e ? e.clockS : l!.clockS
          return (
            <li key={ev.id} className={`item ${l ? 'sp-subrow' : ''} ${VIDEO_ENABLED && e?.videoT != null ? 'seekable' : ''} ${editId === ev.id ? 'editing' : ''}`}
              title={VIDEO_ENABLED && e?.videoT != null ? 'Bấm để xem lại pha này' : undefined}
              onClick={() => { if (VIDEO_ENABLED && e?.videoId && e.videoT != null) { if (!showVideo) toggleVideo(); setTimeout(() => seekVideo(e.videoId!, Math.max(0, e.videoT! - 3), true), 50) } else if (canEdit) setEditId(editId === ev.id ? null : ev.id) }}>
              <span className={`st-dot ${ev.side}`} />
              <span className="grow">
                <span className="muted">{periodLabel(ev.period)}{clock != null ? ` ${mmss(clock)}` : ''}</span> <b>{p ? `#${p.number} ${p.name}` : `TEAM ${ev.side === 'home' ? homeName : awayName}`}</b>{' '}
                {e ? STAT_LABEL[e.type] : l!.kind === 'in' ? 'SUB IN' : 'SUB OUT'}
                {e?.type === 'TOV' && tovInfo.get(e.id) && <span className={`sp-flag ${tovInfo.get(e.id)!.kind === 'stolen' ? 'steal' : ''}`}>{tovInfo.get(e.id)!.kind === 'stolen' ? `bị steal${tovInfo.get(e.id)!.stealerId && byId.get(tovInfo.get(e.id)!.stealerId!) ? ` #${byId.get(tovInfo.get(e.id)!.stealerId!)!.number}` : ''}` : 'tự mất'}</span>}
                {e?.paint && <span className="sp-flag">paint</span>}{e?.fastBreak && <span className="sp-flag">FB</span>}
                {e && suspicious.has(e.id) && <span className="sp-flag warn" title="Cầu thủ không ở trên sân lúc này">⚠ ngoài sân</span>}
              </span>
              {canEdit && <button className={`icon-btn ${editId === ev.id ? 'on' : ''}`} title="Sửa" onClick={(x) => { x.stopPropagation(); setEditId(editId === ev.id ? null : ev.id) }}>✎</button>}
              {canEdit && <button className="icon-btn" title="Xoá" onClick={(ev) => { ev.stopPropagation(); if (e) { if (editId === e.id) setEditId(null); if (lastId === e.id) setLastId(null); removeStat(e.id) } else removeLineup(l!.id) }}>×</button>}
              {canEdit && l && editId === l.id && (
                <SubEditor e={l} players={gamePlayers} update={(patch) => updateLineup(l.id, patch)} say={toast}
                  remove={() => { removeLineup(l.id); setEditId(null) }} close={() => setEditId(null)} />
              )}
              {canEdit && e && editId === e.id && (
                <StatEditor e={e} players={gamePlayers} onCourt={court} homeName={homeName} awayName={awayName}
                  update={(patch) => updateStat(e.id, patch)} say={toast}
                  tov={e.type === 'TOV' ? { info: tovInfo.get(e.id), setKind: (k) => setTovKind(e, k), setStealer: (pid) => setStealer(e, pid) } : undefined}
                  remove={() => { removeStat(e.id); setEditId(null); if (lastId === e.id) setLastId(null) }} close={() => setEditId(null)} />
              )}
            </li>
          )
        })}
    </ul>
  </div>
  )

  const padBlock = (
        <div className={`sp-pad ${sel ? '' : 'idle'}`}>
      {lastStat && canEdit && (
        <div className="sp-last">
          <span className="grow">Vừa ghi: <b>{(() => { const p = byId.get(lastStat.gamePlayerId ?? ''); return p ? `#${p.number} ${p.name}` : `TEAM ${lastStat.side === 'home' ? homeName : awayName}` })()}</b> {STAT_LABEL[lastStat.type]}</span>
          <button onClick={() => { setEditId(lastStat.id); setLastId(null) }}>✎ Sửa</button>
          <button onClick={() => { removeStat(lastStat.id); setLastId(null) }}>↶ Hoàn tác</button>
        </div>
      )}
      <div className="sp-sel">{sel ? <>#{sel.number} {sel.name} <span className="muted">· {sel.side === 'home' ? homeName : awayName}</span></>
        : '—'}</div>
      {fu && (() => {
        const opts = roster(fu.side).filter((x) => court.has(x.id) && x.id !== fu.exclude)
        return (
          <div className={`sp-fu ${fu.side}`}>
            <span className="sp-fu-q">{fu.kind === 'drawn' ? 'Ai bị phạm lỗi?' : fu.kind === 'steal' ? 'Ai cướp bóng?' : 'Ai kiến tạo?'}</span>
            {opts.map((x) => <button key={x.id} onClick={() => answerFu(x.id)} title={x.name}>#{x.number}</button>)}
            <button className="skip" onClick={() => answerFu(null)}>{fu.kind === 'drawn' ? 'Bỏ qua' : 'Không có'}</button>
          </div>
        )
      })()}
      <div className="sp-shot">
        <Court pick={loc} onPick={(x, y) => setLoc(loc && Math.hypot(loc.x - x, loc.y - y) < 0.03 ? null : { x, y })} />
        <div className="sp-shot-side">
          <div className="muted small-note">{loc ? `Vị trí: ${({ paint: 'trong paint', mid: 'tầm trung', corner3: '3 điểm góc', above3: '3 điểm' } as const)[zoneOf(loc.x, loc.y)]}` : 'Chạm sân để chọn vị trí ném (tuỳ chọn)'}</div>
      <div className="sp-mods">
        <button className={mods.paint ? 'on' : ''} title="Cú ném 2 điểm tiếp theo là trong paint (points in the paint)" onClick={() => setMods({ ...mods, paint: !mods.paint })}>🎯 Trong paint</button>
        <button className={mods.fb ? 'on' : ''} title="Cú ném tiếp theo là phản công nhanh (fast break)" onClick={() => setMods({ ...mods, fb: !mods.fb })}>⚡ Fast break</button>
      </div>
          {loc && <button className="btn sm ghost" onClick={() => setLoc(null)}>Bỏ vị trí</button>}
        </div>
      </div>
          <div className="sp-actions">
            {ACTIONS.map((a) => (
              <button key={a.type + (a.tov ?? "")} className={`sp-act ${a.tone ?? ''}`} disabled={!canEdit} onClick={() => record(a.type, a.tov)}>
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
        {game && VIDEO_ENABLED && (
          <button className="btn sm ghost" onClick={toggleVideo}>{showVideo ? 'Ẩn video' : 'Hiện video'}</button>
        )}
        {game && (
          <div className="seg-toggle sp-tabs">
            <button className={tab === 'record' ? 'on' : ''} onClick={() => setTab('record')}>Record</button>
            <button className={tab === 'box' ? 'on' : ''} onClick={() => setTab('box')}>Box score</button>
            <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>Biên bản{stats.some((e) => e.pending) ? ` (${stats.filter((e) => e.pending).length})` : ''}</button>
            <button className={tab === 'analysis' ? 'on' : ''} onClick={() => setTab('analysis')}>Phân tích</button>
          </div>
        )}
      </div>

      {ftStart && game && (
        <div className="modal-back" onClick={() => setFtStart(null)}>
          <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
            <FtFlow key={ftStart.foulId} start={ftStart} canEdit={canEdit} onClose={() => setFtStart(null)} />
          </div>
        </div>
      )}
      {rosterOpen && game && <GameRosterModal side={rosterOpen} onClose={() => setRosterOpen(null)} />}
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
        <div className="sp-box"><BoxScoreView editable={canEdit} onSeek={VIDEO_ENABLED ? (vid, t) => { setTab('record'); if (!showVideo) toggleVideo(); setTimeout(() => seekVideo(vid, t, true), 50) } : undefined} /></div>
      ) : tab === 'sheet' ? (
        <div className="sp-box"><ESheet canEdit={canEdit} /></div>
      ) : tab === 'analysis' ? (
        <div className="sp-box"><Analysis editable={canEdit} /></div>
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
