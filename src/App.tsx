import { useShallow } from 'zustand/react/shallow'
import { useEffect, useRef } from 'react'
import { useData, useUi, selectGame } from './store'
import { goToClip } from './nav'
import { yt } from './youtube'
import { Library } from './components/Library'
import { Roster } from './components/Roster'
import { PlayerPanel } from './components/PlayerPanel'
import { Timeline } from './components/Timeline'
import { MarkPanel, markNow, markIn, markOut, setSelectedIn, setSelectedOut } from './components/MarkPanel'
import { ClipList, useFilteredClips } from './components/ClipList'
import { Comments } from './components/Comments'
import { Login } from './components/Login'
import { Overview } from './components/Overview'
import { RecordHud } from './components/RecordHud'
import { Gutter, SplitV } from './components/Gutter'
import { useLayout, clamp } from './layout'

function Hotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ||
        (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'file'].includes((t as HTMLInputElement).type))
      if (typing) {
        if (e.key === 'Escape') t.blur() // Esc: thoát ô nhập để dùng phím tắt
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); yt.toggle() }
      else if (k === 'j' || k === 'arrowleft') yt.seek(yt.time() - 5)
      else if (k === 'l' || k === 'arrowright') yt.seek(yt.time() + 5)
      else if (k === 'a') markNow('ATK')
      else if (k === 'd') markNow('DEF')
      else if (k === 'i') (e.shiftKey ? setSelectedIn : markIn)()
      else if (k === 'o') (e.shiftKey ? setSelectedOut : markOut)()
      else if (k === 'escape') useUi.getState().set({ inPoint: null })
      else if (k === 'delete' || k === 'backspace') {
        const id = useUi.getState().clipId
        if (id) { useData.getState().removeClip(id); useUi.getState().set({ clipId: null }) }
      }
    }
    // Bấm vào khung YouTube sẽ kéo bàn phím vào trong đó; lấy lại ngay để phím tắt vẫn chạy.
    // Trình duyệt không phải lúc nào cũng báo sự kiện, nên kiểm tra thêm mỗi 0,1 giây.
    const reclaim = () => {
      const el = document.activeElement
      if (el instanceof HTMLIFrameElement) { el.blur(); window.focus() }
    }
    const onBlur = () => setTimeout(reclaim, 0)
    const iv = setInterval(reclaim, 100)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => { clearInterval(iv); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', onBlur) }
  }, [])
  return null
}

/** Phát lần lượt các đoạn đã lọc (qua nhiều hiệp), không cắt file thật. */
function PlaylistRunner() {
  const { playlist, clipId, videoId, time, pending, set } = useUi(useShallow((s) => ({ playlist: s.playlist, clipId: s.clipId, videoId: s.videoId, time: s.time, pending: s.pending, set: s.set })))
  const list = useFilteredClips()
  useEffect(() => {
    if (!playlist || pending) return // đang chờ video hiệp khác tải xong
    const i = list.findIndex((c) => c.id === clipId)
    if (i < 0) return set({ playlist: false })
    const c = list[i]
    if (c.videoId !== videoId) return
    if (time >= c.end) {
      const next = list[i + 1]
      if (next) goToClip(next, true)
      else { set({ playlist: false }); yt.pause() }
    } else if (time < c.start - 1) {
      yt.seek(c.start)
    }
  }, [time, playlist, clipId, videoId, pending, list, set])
  return null
}

export default function App() {
  const { ready, session, error, squads, games, playlists, isSuper, init, signOut, loadGame, profiles } = useData()
  const { squadId, gameId, overview, inPoint, toastMsg, set } = useUi(useShallow((s) => ({ squadId: s.squadId, gameId: s.gameId, overview: s.overview, inPoint: s.inPoint, toastMsg: s.toast, set: s.set })))
  const landed = useRef(false)
  const L = useLayout()

  useEffect(() => { init() }, [init])
  // Chọn tuyến đội đầu tiên khi chưa có / không còn tồn tại.
  useEffect(() => {
    if (squads.length && !squads.some((s) => s.id === squadId)) { set({ squadId: squads[0].id }); selectGame(null) }
  }, [squads, squadId, set])
  useEffect(() => { loadGame(gameId) }, [gameId, loadGame])

  // Link chia sẻ: #g=<gameId>&p=<playlistId>
  const deep = useRef(new URLSearchParams(location.hash.slice(1)))
  useEffect(() => {
    const g = deep.current.get('g')
    const game = g ? games.find((x) => x.id === g) : undefined
    if (game) { set({ squadId: game.squadId }); selectGame(game.id); deep.current.delete('g') }
  }, [games, set])
  // Tài khoản quản trị: mở thẳng màn hình tổng quan để chọn trận.
  useEffect(() => {
    if (isSuper && !landed.current && !deep.current.get('g')) { landed.current = true; set({ overview: true }) }
  }, [isSuper, set])
  useEffect(() => {
    const p = deep.current.get('p')
    const pl = p ? playlists.find((x) => x.id === p) : undefined
    if (pl) { set({ filter: { side: pl.side, playerIds: pl.playerIds, playType: pl.playType }, playlistId: pl.id }); deep.current.delete('p') }
  }, [playlists, set])

  if (!ready) return <div className="login muted">Đang tải…</div>
  if (!session) return <Login />

  const me = profiles[session.user.id] || session.user.email || ''
  return (
    <div className="app">
      <Hotkeys />
      <PlaylistRunner />
      <header className="topbar">
        <div className="logo"><span className="dot" />GAME<b>REVIEW</b></div>
        <span className="spacer" />
        {error && <span className="banner" title="Bấm để ẩn" onClick={() => useData.setState({ error: '' })}>{error}</span>}
        <span className="hint"><kbd>Space</kbd> phát/dừng · <kbd>J</kbd><kbd>L</kbd> ±5s · <kbd>I</kbd> vào · <kbd>O</kbd> ra · <kbd>A</kbd> tấn công · <kbd>D</kbd> phòng thủ</span>
        <button className="btn sm primary" onClick={() => set({ overview: true })}>Tất cả trận</button>
        <button className="btn sm" title="Đưa các module về kích thước mặc định" onClick={L.reset}>Đặt lại bố cục</button>
        <span>{me}</span>
        {isSuper && <span className="pill live">ADMIN</span>}
        <button className="btn sm" onClick={signOut}>Đăng xuất</button>
      </header>
      {overview && <Overview />}
      <RecordHud />
      {toastMsg && inPoint == null && <div className="toast">{toastMsg}</div>}
      {inPoint != null && <div className="inpoint-flag">Đang chờ điểm Ra… bấm <kbd>O</kbd> để kết thúc, <kbd>Esc</kbd> để huỷ</div>}
      <div className="workspace">
        <div className="col" style={{ width: L.left }}>
          <SplitV frac={L.leftSplit} setFrac={(f) => L.set({ leftSplit: f })} top={<Library />} bottom={<Roster />} />
        </div>
        <Gutter dir="col" begin={() => L.left} move={(s, dx) => L.set({ left: clamp(s + dx, 200, 520) })} />

        <div className="col center">
          <div className="slot grow"><PlayerPanel /></div>
          <Gutter dir="row" begin={() => L.tlH} move={(s, _dx, dy) => L.set({ tlH: clamp(s - dy, 70, 400) })} />
          <div className="slot" style={{ height: L.tlH }}><Timeline /></div>
          <Gutter dir="row" begin={() => L.clipsH} move={(s, _dx, dy) => L.set({ clipsH: clamp(s - dy, 120, 700) })} />
          <div className="slot" style={{ height: L.clipsH }}><ClipList /></div>
        </div>

        <Gutter dir="col" begin={() => L.right} move={(s, dx) => L.set({ right: clamp(s - dx, 260, 700) })} />
        <div className="col" style={{ width: L.right }}>
          <SplitV frac={L.rightSplit} setFrac={(f) => L.set({ rightSplit: f })} top={<MarkPanel />} bottom={<Comments />} />
        </div>
      </div>
    </div>
  )
}
