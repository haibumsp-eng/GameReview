import { useData, useUi } from '../store'
import { PLAY_TYPES } from '../types'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'

export function markNow(side: 'ATK' | 'DEF') {
  const { gameId, pre, post, set } = useUi.getState()
  if (!gameId) return
  const id = useData.getState().addClip(gameId, yt.time(), side, pre, post)
  set({ clipId: id, playlist: false })
}

export function MarkPanel() {
  const { gameId, clipId, squadId, set } = useUi()
  const clip = useData((s) => s.clips.find((c) => c.id === clipId))
  const players = useData((s) => s.players).filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)
  const { updateClip, removeClip } = useData()

  const nudge = (k: 'start' | 'end', d: number) =>
    clip && updateClip(clip.id, { [k]: Math.max(0, clip[k] + d) })
  const togglePlayer = (pid: string) =>
    clip &&
    updateClip(clip.id, {
      teamWide: false,
      playerIds: clip.playerIds.includes(pid) ? clip.playerIds.filter((x) => x !== pid) : [...clip.playerIds, pid],
    })

  return (
    <Panel title="Đánh dấu">
      <div className="row">
        <button className="btn atk big" disabled={!gameId} onClick={() => markNow('ATK')}>Tấn công <kbd>A</kbd></button>
        <button className="btn def big" disabled={!gameId} onClick={() => markNow('DEF')}>Phòng thủ <kbd>D</kbd></button>
      </div>

      {!clip ? (
        <div className="placeholder small">
          Bấm <kbd>A</kbd> / <kbd>D</kbd> khi xem để đánh dấu ngay tình huống,
          rồi gắn cầu thủ và ghi chú ở đây.
        </div>
      ) : (
        <div className="stack">
          <div className="seg-toggle">
            <button className={clip.side === 'ATK' ? 'on atk' : ''} onClick={() => updateClip(clip.id, { side: 'ATK' })}>Tấn công</button>
            <button className={clip.side === 'DEF' ? 'on def' : ''} onClick={() => updateClip(clip.id, { side: 'DEF' })}>Phòng thủ</button>
          </div>

          <label className="field-label">Cầu thủ</label>
          <div className="chips">
            <button
              className={clip.teamWide ? 'chip on' : 'chip'}
              onClick={() => updateClip(clip.id, { teamWide: !clip.teamWide, playerIds: [] })}
            >Cả đội</button>
            {players.map((p) => (
              <button key={p.id} className={clip.playerIds.includes(p.id) ? 'chip on' : 'chip'} onClick={() => togglePlayer(p.id)} title={p.name}>
                <b>{p.number}</b> {p.name}
              </button>
            ))}
          </div>

          <label className="field-label">Loại tình huống</label>
          <select value={clip.playType} onChange={(e) => updateClip(clip.id, { playType: e.target.value })}>
            <option value="">— chưa chọn —</option>
            {PLAY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>

          <label className="field-label">Đoạn clip</label>
          <div className="range">
            <div>
              <button className="btn sm" onClick={() => nudge('start', -1)}>−1</button>
              <button className="timebtn" onClick={() => yt.seek(clip.start)}>{fmt(clip.start)}</button>
              <button className="btn sm" onClick={() => nudge('start', 1)}>+1</button>
            </div>
            <span className="muted">→</span>
            <div>
              <button className="btn sm" onClick={() => nudge('end', -1)}>−1</button>
              <button className="timebtn" onClick={() => yt.seek(clip.end)}>{fmt(clip.end)}</button>
              <button className="btn sm" onClick={() => nudge('end', 1)}>+1</button>
            </div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => updateClip(clip.id, { start: Math.min(yt.time(), clip.end - 1) })}>Đặt Vào = hiện tại</button>
            <button className="btn sm" onClick={() => updateClip(clip.id, { end: Math.max(yt.time(), clip.start + 1) })}>Đặt Ra = hiện tại</button>
          </div>

          <label className="field-label">Nhận xét</label>
          <textarea rows={4} placeholder="Ghi chú tình huống…" value={clip.note} onChange={(e) => updateClip(clip.id, { note: e.target.value })} />

          <button className="btn danger" onClick={() => { removeClip(clip.id); set({ clipId: null }) }}>Xoá mark <kbd>Del</kbd></button>
        </div>
      )}
    </Panel>
  )
}
