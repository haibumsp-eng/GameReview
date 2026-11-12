import { useUi } from '../store'
import { cancelRecording } from '../lib/recordScreen'
import { fmt } from '../util'

/** Thanh trạng thái khi đang quay, và cửa sổ tải file khi xong. */
export function RecordHud() {
  const rec = useUi((s) => s.rec)
  const set = useUi((s) => s.set)
  if (!rec) return null

  if (rec.phase === 'done' || rec.phase === 'error') {
    const close = () => { if (rec.url) URL.revokeObjectURL(rec.url); set({ rec: null }) }
    const name = (rec.title ?? 'video').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'video'
    return (
      <div className="modal-back">
        <div className="modal card stack">
          <div className="row"><b className="grow">{rec.phase === 'done' ? 'Đã quay xong' : 'Không quay được'}</b><button className="icon-btn" onClick={close}>×</button></div>
          {rec.msg && <div className={rec.phase === 'error' ? 'err' : 'muted'}>{rec.msg}</div>}
          {rec.phase === 'done' && rec.url && (
            <>
              <video className="rec-preview" src={rec.url} controls />
              <a className="btn primary" href={rec.url} download={`${name}.${rec.ext}`}>⬇ Tải file .{rec.ext} ({((rec.size ?? 0) / 1e6).toFixed(1)} MB)</a>
              {rec.ext === 'webm' && <div className="muted">File .webm xem tốt trên máy tính. iPhone có thể không mở được; dùng Chrome bản mới để có file .mp4.</div>}
            </>
          )}
          <button className="btn" onClick={close}>Đóng</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`rec-hud ${rec.phase}`}>
      <span className="rec-dot" />
      <span>
        {rec.phase === 'recording' && <>Đang quay đoạn <b>{rec.index}/{rec.total}</b> · còn khoảng <b>{fmt(rec.remain)}</b></>}
        {rec.phase !== 'recording' && <>{rec.msg} <span className="muted">({rec.index}/{rec.total})</span></>}
      </span>
      <button className="btn sm" onClick={cancelRecording}>Huỷ</button>
    </div>
  )
}
