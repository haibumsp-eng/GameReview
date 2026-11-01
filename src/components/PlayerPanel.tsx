import { useEffect, useRef } from 'react'
import { useData, useUi } from '../store'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'

export function PlayerPanel() {
  const gameId = useUi((s) => s.gameId)
  const { time, duration, playing, pre, post, playlist, set } = useUi()
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!game || !host.current) { yt.destroy(); return }
    const el = host.current
    el.innerHTML = ''
    yt.mount(el, game.youtubeId, () => set({ duration: yt.duration() }))
    return () => yt.destroy()
  }, [game?.id, game?.youtubeId, set])

  // Poll vị trí phát để đồng bộ timeline / playlist.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!yt.ready()) return
      set({ time: yt.time(), duration: yt.duration(), playing: yt.playing() })
    }, 120)
    return () => clearInterval(iv)
  }, [set])

  return (
    <Panel
      title={game ? game.title : 'Player'}
      area="player"
      className="player-panel"
      actions={
        <div className="row tight">
          <span className="muted">Trước</span>
          <input className="mini" type="number" min={0} value={pre} onChange={(e) => set({ pre: +e.target.value })} />
          <span className="muted">Sau</span>
          <input className="mini" type="number" min={0} value={post} onChange={(e) => set({ post: +e.target.value })} />
          <span className="muted">giây</span>
        </div>
      }
    >
      {!game ? (
        <div className="placeholder">Chọn hoặc thêm một trận ở panel “Thư viện”.</div>
      ) : (
        <>
          <div className="video-wrap"><div ref={host} className="video-host" /></div>
          <div className="transport">
            <button className="btn" onClick={() => yt.seek(time - 5)} title="J">⟲ 5s</button>
            <button className="btn primary" onClick={() => yt.toggle()} title="Space">{playing ? '❚❚ Dừng' : '▶ Phát'}</button>
            <button className="btn" onClick={() => yt.seek(time + 5)} title="L">5s ⟳</button>
            <span className="timecode">{fmt(time)} / {fmt(duration)}</span>
            <span className="spacer" />
            {playlist && <span className="pill live">PLAYLIST ĐANG PHÁT</span>}
          </div>
        </>
      )}
    </Panel>
  )
}
