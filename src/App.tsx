import { useEffect } from 'react'
import { useData, useUi } from './store'
import { yt } from './youtube'
import { Library } from './components/Library'
import { Roster } from './components/Roster'
import { PlayerPanel } from './components/PlayerPanel'
import { Timeline } from './components/Timeline'
import { MarkPanel, markNow } from './components/MarkPanel'
import { ClipList, useFilteredClips } from './components/ClipList'
import { Comments } from './components/Comments'

function Hotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); yt.toggle() }
      else if (k === 'j' || k === 'arrowleft') yt.seek(yt.time() - 5)
      else if (k === 'l' || k === 'arrowright') yt.seek(yt.time() + 5)
      else if (k === 'a') markNow('ATK')
      else if (k === 'd') markNow('DEF')
      else if (k === 'delete' || k === 'backspace') {
        const id = useUi.getState().clipId
        if (id) { useData.getState().removeClip(id); useUi.getState().set({ clipId: null }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

/** Phát lần lượt các đoạn đã lọc, không cắt file thật. */
function PlaylistRunner() {
  const { playlist, clipId, time, set } = useUi()
  const list = useFilteredClips()
  useEffect(() => {
    if (!playlist) return
    const i = list.findIndex((c) => c.id === clipId)
    if (i < 0) return set({ playlist: false })
    const c = list[i]
    if (time >= c.end) {
      const next = list[i + 1]
      if (next) { set({ clipId: next.id }); yt.seek(next.start) }
      else { set({ playlist: false }); yt.pause() }
    } else if (time < c.start - 1) {
      yt.seek(c.start)
    }
  }, [time, playlist, clipId, list, set])
  return null
}

export default function App() {
  const user = useData((s) => s.user)
  const setUser = useData((s) => s.setUser)
  return (
    <div className="app">
      <Hotkeys />
      <PlaylistRunner />
      <header className="topbar" style={{ gridArea: 'top' }}>
        <div className="logo"><span className="dot" />GAME<b>REVIEW</b></div>
        <span className="spacer" />
        <span className="hint"><kbd>Space</kbd> phát/dừng · <kbd>J</kbd><kbd>L</kbd> ±5s · <kbd>A</kbd> tấn công · <kbd>D</kbd> phòng thủ</span>
        <button className="btn sm" onClick={() => { const n = prompt('Tên của bạn?', user); if (n !== null) setUser(n.trim()) }}>
          {user || 'Đặt tên'}
        </button>
      </header>
      <Library />
      <PlayerPanel />
      <Timeline />
      <MarkPanel />
      <Roster />
      <ClipList />
      <Comments />
    </div>
  )
}
