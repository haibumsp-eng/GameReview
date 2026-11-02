import { useState } from 'react'
import { useData, useUi } from '../store'
import { fmt } from '../util'
import { yt } from '../youtube'
import { Panel } from './Panel'

export function Comments() {
  const clipId = useUi((s) => s.clipId)
  const { comments, addComment, profiles, players } = useData()
  const clip = useData((s) => s.clips.find((c) => c.id === clipId))
  const [text, setText] = useState('')
  const list = comments.filter((c) => c.clipId === clipId).sort((a, b) => a.createdAt - b.createdAt)

  const send = () => {
    if (!clipId || !text.trim()) return
    addComment(clipId, text.trim())
    setText('')
  }

  return (
    <Panel title="Bình luận">
      {!clipId ? (
        <div className="placeholder small">Chọn một tình huống để xem và thêm bình luận.</div>
      ) : (
        <>
          {clip && (
            <div className="card stack clip-sum">
              <div className="row">
                <span className={`badge ${clip.side}`}>{clip.side === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'}</span>
                <button className="timebtn" onClick={() => yt.seek(clip.start)}>{fmt(clip.start)}–{fmt(clip.end)}</button>
                {clip.playType && <span className="tag">{clip.playType}</span>}
              </div>
              <div>
                {clip.teamWide ? <b>Cả đội</b> : clip.playerIds.length
                  ? clip.playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean).map((p) => `#${p!.number} ${p!.name}`).join(', ')
                  : <span className="muted">Chưa gắn cầu thủ</span>}
              </div>
              {clip.note && <div className="clip-note">{clip.note}</div>}
              <div className="muted">Bình luận của {profiles[clip.author] || 'HLV'}</div>
            </div>
          )}
          <ul className="list comments">
            {list.length === 0 && <li className="empty">Chưa có bình luận.</li>}
            {list.map((c) => (
              <li key={c.id} className="cmt">
                <div className="cmt-h"><b>{profiles[c.author] || 'Ẩn danh'}</b> <span className="muted">{new Date(c.createdAt).toLocaleString('vi-VN')}</span></div>
                <div>{c.text}</div>
              </li>
            ))}
          </ul>
          <div className="row">
            <input
              placeholder="Viết bình luận…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button className="btn primary sm" onClick={send}>Gửi</button>
          </div>
        </>
      )}
    </Panel>
  )
}
