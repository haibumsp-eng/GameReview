import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, toast } from '../store'
import { PLAY_TYPES } from '../types'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'
import { AutoTextarea } from './AutoTextarea'

const warn = (msg: string) => useData.setState({ error: msg })

/** A / D: đánh dấu nhanh. Nếu đã bấm I trước đó thì lấy đoạn từ điểm Vào tới hiện tại. */
export function markNow(side: 'ATK' | 'DEF') {
  const { gameId, videoId, pre, post, inPoint, set } = useUi.getState()
  if (!gameId || !videoId) return warn('Hãy mở một trận (và một hiệp) trước khi đánh dấu.')
  const t = yt.time()
  const useIn = inPoint != null && t > inPoint
  const start = useIn ? inPoint! : Math.max(0, t - pre)
  const end = useIn ? t : t + post
  const id = useData.getState().addClip(gameId, videoId, start, end, side)
  set({ clipId: id, playlist: false, inPoint: null, lastSide: side })
  toast(`Đã tạo tình huống ${side === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'} ${fmt(start)}–${fmt(end)}`)
}

/** I: bắt đầu một tình huống mới tại vị trí hiện tại. */
export function markIn() {
  const { gameId, videoId, set } = useUi.getState()
  if (!gameId || !videoId) return warn('Hãy mở một trận (và một hiệp) trước khi đánh dấu.')
  set({ inPoint: yt.time() })
}

/** O: kết thúc tình huống đang chờ. Nếu không có điểm Vào đang chờ thì chỉnh điểm Ra của tình huống đang chọn. */
export function markOut() {
  const { gameId, videoId, inPoint, lastSide, clipId, set } = useUi.getState()
  if (!gameId || !videoId) return warn('Hãy mở một trận (và một hiệp) trước khi đánh dấu.')
  const t = yt.time()
  if (inPoint == null) {
    if (!clipId) return warn('Bấm I ở đầu tình huống trước, rồi mới bấm O ở cuối.')
    setSelectedOut()
    return toast(`Đã đặt điểm Ra ${fmt(t)}`)
  }
  if (t <= inPoint + 0.5) return warn('Điểm Ra phải sau điểm Vào. Hãy chạy video tới chỗ muốn dừng rồi bấm O.')
  const id = useData.getState().addClip(gameId, videoId, inPoint, t, lastSide)
  set({ clipId: id, playlist: false, inPoint: null })
  toast(`Đã tạo tình huống ${lastSide === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'} ${fmt(inPoint)}–${fmt(t)} (đổi ở panel Đánh dấu nếu cần)`)
}

export function setSelectedIn() {
  const { clipId } = useUi.getState()
  const c = useData.getState().clips.find((x) => x.id === clipId)
  if (c) useData.getState().updateClip(c.id, { start: Math.min(yt.time(), c.end - 1) })
}
export function setSelectedOut() {
  const { clipId } = useUi.getState()
  const c = useData.getState().clips.find((x) => x.id === clipId)
  if (c) useData.getState().updateClip(c.id, { end: Math.max(yt.time(), c.start + 1) })
}

export function MarkPanel() {
  const { gameId, clipId, squadId, inPoint, set } = useUi(useShallow((s) => ({ gameId: s.gameId, clipId: s.clipId, squadId: s.squadId, inPoint: s.inPoint, set: s.set })))
  const clip = useData((s) => s.clips.find((c) => c.id === clipId))
  const allClips = useData((s) => s.clips)
  const players = useData((s) => s.players).filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)
  const { updateClip, removeClip } = useData()

  const used = [...new Set(allClips.filter((c) => c.gameId === gameId).map((c) => c.playType).filter(Boolean))]
  const suggestions = [...new Set([...used, ...PLAY_TYPES])]

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
        <button className="btn atk big" disabled={!gameId} onClick={() => markNow('ATK')}><span>Tấn công</span><kbd>A</kbd></button>
        <button className="btn def big" disabled={!gameId} onClick={() => markNow('DEF')}><span>Phòng thủ</span><kbd>D</kbd></button>
      </div>

      <div className="inout">
        <div className="row">
          <button className="btn grow-btn" disabled={!gameId} onClick={markIn}><kbd>I</kbd> Điểm vào</button>
          <button className="btn grow-btn" disabled={!gameId} onClick={markOut}><kbd>O</kbd> Điểm ra</button>
        </div>
        {inPoint != null ? (
          <div className="inout-wait">
            <span>Đã đặt <b>Vào {fmt(inPoint)}</b>. Chạy tới chỗ kết thúc rồi bấm <kbd>O</kbd> (hoặc <kbd>A</kbd>/<kbd>D</kbd> để chọn luôn tấn công/phòng thủ).</span>
            <button className="btn sm" onClick={() => set({ inPoint: null })}>Huỷ <kbd>Esc</kbd></button>
          </div>
        ) : (
          <div className="muted small-note">Chạy video tới lúc tình huống bắt đầu → bấm <kbd>I</kbd>; tới lúc kết thúc → bấm <kbd>O</kbd>.</div>
        )}
      </div>

      {!clip ? (
        <div className="placeholder small">
          Hoặc bấm <kbd>A</kbd> / <kbd>D</kbd> để đánh dấu nhanh quanh vị trí hiện tại,
          rồi gắn cầu thủ và ghi chú ở đây.
        </div>
      ) : (
        <div className="stack edit-card">
          <div className="edit-head">
            <span className="edit-title">Tình huống đang chọn</span>
            <button className="timebtn" onClick={() => yt.seek(clip.start)}>{fmt(clip.start)}–{fmt(clip.end)}</button>
          </div>
          <div className="seg-toggle">
            <button className={clip.side === 'ATK' ? 'on atk' : ''} onClick={() => { updateClip(clip.id, { side: 'ATK' }); set({ lastSide: 'ATK' }) }}>Tấn công</button>
            <button className={clip.side === 'DEF' ? 'on def' : ''} onClick={() => { updateClip(clip.id, { side: 'DEF' }); set({ lastSide: 'DEF' }) }}>Phòng thủ</button>
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
          <input
            list="playtypes"
            placeholder="Tự gõ hoặc chọn gợi ý (có thể để trống)"
            value={clip.playType}
            onChange={(e) => updateClip(clip.id, { playType: e.target.value })}
          />
          <datalist id="playtypes">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>

          <label className="field-label">Điểm vào → điểm ra</label>
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
            <button className="btn sm" onClick={setSelectedIn}>Vào = hiện tại <kbd>⇧I</kbd></button>
            <button className="btn sm" onClick={setSelectedOut}>Ra = hiện tại <kbd>⇧O</kbd></button>
          </div>

          <label className="field-label">Nhận xét</label>
          <AutoTextarea minRows={4} placeholder="Ghi chú tình huống…" value={clip.note} onChange={(e) => updateClip(clip.id, { note: e.target.value })} />

          <button className="btn danger" onClick={() => { removeClip(clip.id); set({ clipId: null }) }}>Xoá mark <kbd>Del</kbd></button>
        </div>
      )}
    </Panel>
  )
}
