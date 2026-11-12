import { useEffect, useRef } from 'react'
import { useData, useUi, videosOf } from '../store'
import { yt } from '../youtube'
import { defaultLabel, fmt, parseYouTubeId } from '../util'
import { Panel } from './Panel'

export function PlayerPanel() {
  const { gameId, videoId, time, duration, playing, pre, post, playlist, autoNext, set } = useUi()
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const allVideos = useData((s) => s.videos)
  const { addVideo, removeVideo, renameVideo } = useData()
  const videos = allVideos.filter((v) => v.gameId === gameId).sort((a, b) => a.position - b.position)
  const video = videos.find((v) => v.id === videoId)
  const host = useRef<HTMLDivElement>(null)
  const advancedFrom = useRef<string | null>(null)

  // Nếu video đang chọn không còn thuộc trận này thì về video đầu tiên.
  useEffect(() => {
    if (gameId && !video && videos.length) set({ videoId: videos[0].id })
  }, [gameId, video, videos.length, set]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nạp player khi đổi video. Sau khi sẵn sàng thì tua tới mốc đang chờ (khi nhảy giữa các hiệp).
  useEffect(() => {
    if (!video || !host.current) { yt.destroy(); return }
    const el = host.current
    el.innerHTML = ''
    advancedFrom.current = null
    yt.mount(el, video.youtubeId, () => {
      const p = useUi.getState().pending
      if (p) {
        yt.seek(p.t)
        if (p.play) yt.play()
        useUi.getState().set({ pending: null })
      }
      set({ duration: yt.duration() })
    })
    return () => yt.destroy()
  }, [video?.id, video?.youtubeId, set]) // eslint-disable-line react-hooks/exhaustive-deps

  // Đồng bộ vị trí phát; hết hiệp thì tự sang hiệp sau nếu bật "xem nối tiếp".
  useEffect(() => {
    const iv = setInterval(() => {
      if (!yt.ready()) return
      set({ time: yt.time(), duration: yt.duration(), playing: yt.playing() })
      const ui = useUi.getState()
      if (ui.autoNext && !ui.playlist && yt.ended() && ui.videoId && advancedFrom.current !== ui.videoId) {
        const list = videosOf(ui.gameId)
        const i = list.findIndex((v) => v.id === ui.videoId)
        const next = list[i + 1]
        if (next) {
          advancedFrom.current = ui.videoId
          set({ videoId: next.id, clipId: null, pending: { t: 0, play: true }, time: 0 })
        }
      }
    }, 150)
    return () => clearInterval(iv)
  }, [set])

  const pick = (id: string) => {
    if (id === videoId) return
    set({ videoId: id, clipId: null, playlist: false, inPoint: null, pending: null, time: 0 })
  }

  const add = () => {
    if (!gameId) return
    const link = prompt('Dán link YouTube của hiệp / video mới:')
    if (!link) return
    const id = parseYouTubeId(link)
    if (!id) return alert('Link YouTube không hợp lệ')
    const label = prompt('Tên video', defaultLabel(videos.length + 1))?.trim() || defaultLabel(videos.length + 1)
    pick(addVideo(gameId, label, id))
  }

  return (
    <Panel
      title={game ? game.title : 'Player'}
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
        <div className="placeholder">Chọn một trận ở panel “Thư viện” hoặc bấm “Tất cả trận”.</div>
      ) : (
        <>
          <div className="vtabs">
            {videos.map((v) => (
              <button
                key={v.id}
                className={v.id === videoId ? 'vtab on' : 'vtab'}
                onClick={() => pick(v.id)}
                onDoubleClick={() => { const n = prompt('Đổi tên video', v.label)?.trim(); if (n) renameVideo(v.id, n) }}
                title="Bấm đúp để đổi tên"
              >{v.label}</button>
            ))}
            <button className="vtab add" onClick={add} title="Thêm hiệp / OT bằng link YouTube">+ Hiệp / OT</button>
            <span className="spacer" />
            {videos.length > 1 && (
              <>
                <label className="row tight muted" title="Hết hiệp này tự chuyển sang hiệp tiếp theo">
                  <input type="checkbox" style={{ width: 'auto' }} checked={autoNext} onChange={(e) => set({ autoNext: e.target.checked })} />
                  Xem nối tiếp
                </label>
                {video && (
                  <button
                    className="icon-btn"
                    title={`Xoá ${video.label} (và các mark trong đó)`}
                    onClick={() => { if (confirm(`Xoá “${video.label}” cùng các mark trong hiệp này?`)) removeVideo(video.id) }}
                  >×</button>
                )}
              </>
            )}
          </div>
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
