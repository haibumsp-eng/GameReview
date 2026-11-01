import { useState } from 'react'
import { useData, useUi } from '../store'
import { Panel } from './Panel'

export function Comments() {
  const clipId = useUi((s) => s.clipId)
  const { comments, addComment, profiles } = useData()
  const [text, setText] = useState('')
  const list = comments.filter((c) => c.clipId === clipId).sort((a, b) => a.createdAt - b.createdAt)

  const send = () => {
    if (!clipId || !text.trim()) return
    addComment(clipId, text.trim())
    setText('')
  }

  return (
    <Panel title="Bình luận" area="comments">
      {!clipId ? (
        <div className="placeholder small">Chọn một tình huống để xem và thêm bình luận.</div>
      ) : (
        <>
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
