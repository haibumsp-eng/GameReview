import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, toast } from '../store'
import { PLAY_TYPES } from '../types'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'
import { AutoTextarea } from './AutoTextarea'
import { useEffect } from 'react'
import type { Clip } from '../types'
import { confirmDialog } from '../lib/dialog'

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

          <SpotlightControls clip={clip} />

          <button className="btn danger" onClick={() => { removeClip(clip.id); set({ clipId: null }) }}>Xoá mark <kbd>Del</kbd></button>
        </div>
      )}
    </Panel>
  )
}

/** Khoanh cầu thủ khi dừng hình: tạo, sửa, xem thử, xoá. */
function SpotlightControls({ clip }: { clip: Clip }) {
  const spotEdit = useUi((s) => s.spotEdit)
  const set = useUi((s) => s.set)
  const updateClip = useData((s) => s.updateClip)
  const allPlayers = useData((s) => s.players)
  const squadId = useUi((s) => s.squadId)
  const editing = spotEdit && spotEdit.clipId === clip.id ? spotEdit : null
  const sp = clip.spotlight

  // Đổi sang tình huống khác thì huỷ việc vẽ đang dở.
  useEffect(() => {
    const e = useUi.getState().spotEdit
    if (e && e.clipId !== clip.id) useUi.getState().set({ spotEdit: null })
  }, [clip.id])

  const players = [...allPlayers.filter((p) => p.squadId === squadId)].sort((a, b) =>
    (clip.playerIds.includes(b.id) ? 1 : 0) - (clip.playerIds.includes(a.id) ? 1 : 0) || a.number - b.number)
  const within = (t: number) => Math.min(clip.end - 0.3, Math.max(clip.start, t))

  const begin = () => {
    yt.pause()
    let t = yt.time()
    if (t < clip.start || t > clip.end) { t = Math.min(clip.end, clip.start + 1); yt.seek(t) }
    set({ spotEdit: { clipId: clip.id, t: within(t), hold: 2, boxes: [] } })
  }
  const edit = () => {
    if (!sp) return
    yt.pause(); yt.seek(sp.t)
    set({ spotEdit: { clipId: clip.id, t: sp.t, hold: sp.hold, boxes: sp.boxes } })
  }
  const save = () => {
    if (!editing) return
    updateClip(clip.id, { spotlight: { t: editing.t, hold: editing.hold, boxes: editing.boxes } })
    set({ spotEdit: null })
    toast('Đã lưu khoanh cầu thủ')
  }
  const preview = () => {
    if (!sp) return
    const from = Math.max(clip.start, sp.t - 1.5)
    yt.seek(from)
    yt.play()
    set({ spotPreview: clip.id, playlist: false })
    setTimeout(() => { if (useUi.getState().spotPreview === clip.id) set({ spotPreview: null }) }, (sp.t - from + sp.hold + 2) * 1000)
  }
  const setBox = (i: number, label: string) =>
    editing && set({ spotEdit: { ...editing, boxes: editing.boxes.map((b, j) => (j === i ? { ...b, label: label || undefined } : b)) } })

  return (
    <>
      <label className="field-label">Khoanh cầu thủ</label>
      {editing ? (
        <div className="card stack spot-edit">
          <div className="small-note">
            <b>Kéo chuột trên video</b> để khoanh cầu thủ (tối đa 3 khung). Video sẽ dừng hình tại <b>{fmt(editing.t)}</b> và hiện các khung này.
          </div>
          <button className="btn sm" onClick={() => { yt.pause(); set({ spotEdit: { ...editing, t: within(yt.time()) } }) }}>Lấy khung hình đang dừng</button>
          {editing.boxes.length === 0 && <div className="muted small-note">Chưa có khung nào.</div>}
          {editing.boxes.map((b, i) => (
            <div key={i} className="row">
              <span className="spot-num">{i + 1}</span>
              <select value={b.label ?? ''} onChange={(e) => setBox(i, e.target.value)}>
                <option value="">— không ghi tên —</option>
                {players.map((p) => <option key={p.id} value={`#${p.number} ${p.name}`}>#{p.number} {p.name}</option>)}
              </select>
              <button className="icon-btn" title="Xoá khung" onClick={() => set({ spotEdit: { ...editing, boxes: editing.boxes.filter((_, j) => j !== i) } })}>×</button>
            </div>
          ))}
          <div className="row">
            <span className="muted">Dừng hình</span>
            <select style={{ width: 110 }} value={editing.hold} onChange={(e) => set({ spotEdit: { ...editing, hold: +e.target.value } })}>
              {[1, 1.5, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} giây</option>)}
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={() => set({ spotEdit: null })}>Huỷ</button>
            <button className="btn primary grow-btn" disabled={!editing.boxes.length} onClick={save}>Lưu khoanh</button>
          </div>
        </div>
      ) : sp ? (
        <div className="spot-info">
          <span>🎯 Dừng tại <b>{fmt(sp.t)}</b> · {sp.boxes.length} khung · {sp.hold} giây</span>
          <div className="row">
            <button className="btn sm" onClick={preview}>Xem thử</button>
            <button className="btn sm" onClick={edit}>Sửa</button>
            <button className="icon-btn" title="Bỏ khoanh" onClick={async () => { if (await confirmDialog({ title: 'Bỏ khoanh cầu thủ?', message: 'Tình huống này sẽ không dừng hình và khoanh cầu thủ nữa.', okText: 'Bỏ khoanh', danger: true })) updateClip(clip.id, { spotlight: null }) }}>×</button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={begin}>🎯 Khoanh cầu thủ tại khoảnh khắc đang dừng</button>
      )}
    </>
  )
}
