import { useState } from 'react'
import { useData, useUi, playerLabel, myOrgRole } from '../store'
import { confirmDialog } from '../lib/dialog'
import { fmt } from '../util'
import { goToClip } from '../nav'
import { AutoTextarea } from './AutoTextarea'
import { Panel } from './Panel'

export function Comments() {
  const clipId = useUi((s) => s.clipId)
  const orgId = useUi((s) => s.orgId)
  const comments = useData((s) => s.comments)
  const { addComment, updateComment, removeComment, updateClip } = useData.getState()
  const profiles = useData((s) => s.profiles)
  const me = useData((s) => s.session?.user.id)
  const isSuper = useData((s) => s.isSuper)
  const clip = useData((s) => s.clips.find((c) => c.id === clipId))
  const [text, setText] = useState('')
  const [editNote, setEditNote] = useState(false)          // đang sửa nhận xét của tình huống
  const [editId, setEditId] = useState<string | null>(null) // đang sửa bình luận nào
  const [draft, setDraft] = useState('')
  const role = myOrgRole(orgId)
  const canEdit = isSuper || (role !== null && role !== 'viewer') // sửa nhận xét: người sửa được tuyến
  const list = comments.filter((c) => c.clipId === clipId).sort((a, b) => a.createdAt - b.createdAt)

  const send = () => {
    if (!clip || !text.trim()) return
    addComment(clip.id, text.trim())
    setText('')
  }
  const startEdit = (id: string, t: string) => { setEditId(id); setDraft(t) }
  const saveEdit = () => {
    const t = draft.trim()
    const c = comments.find((x) => x.id === editId)
    if (!c) return setEditId(null)
    if (!t) return // không để trống: muốn bỏ thì dùng Xoá
    if (t !== c.text) updateComment(c.id, t)
    setEditId(null)
  }
  const remove = async (id: string) => {
    if (await confirmDialog({ title: 'Xoá bình luận?', message: 'Bình luận này sẽ bị xoá khỏi tình huống.', okText: 'Xoá', danger: true })) removeComment(id)
  }

  return (
    <Panel title="Bình luận">
      {!clip ? (
        <div className="placeholder small">Chọn một tình huống để xem và thêm bình luận.</div>
      ) : (
        <>
          <div className="card stack clip-sum">
            <div className="row">
              <span className={`badge ${clip.side}`}>{clip.side === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'}</span>
              <button className="timebtn" onClick={() => goToClip(clip)}>{fmt(clip.start)}–{fmt(clip.end)}</button>
              {clip.playType && <span className="tag">{clip.playType}</span>}
            </div>
            <div>
              {clip.teamWide ? <b>Cả đội</b> : clip.playerIds.length
                ? clip.playerIds.map((id) => playerLabel(id)).filter(Boolean).join(', ')
                : <span className="muted">Chưa gắn cầu thủ</span>}
            </div>
            {editNote ? (
              <div className="stack">
                <AutoTextarea minRows={3} maxHeight={220} autoFocus placeholder="Nhận xét của HLV về tình huống…" value={clip.note}
                  onChange={(e) => updateClip(clip.id, { note: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditNote(false) }} />
                <div className="row"><span className="muted small-note grow">Tự lưu khi gõ. Dùng để sửa chính tả hoặc thông tin.</span>
                  <button className="btn sm primary" onClick={() => setEditNote(false)}>Xong</button></div>
              </div>
            ) : (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="clip-note grow">{clip.note || <span className="muted">Chưa có nhận xét.</span>}</div>
                {canEdit && <button className="btn sm ghost" title="Sửa nhận xét của tình huống" onClick={() => setEditNote(true)}>✎ Sửa nhận xét</button>}
              </div>
            )}
            <div className="muted">Đánh dấu bởi {profiles[clip.author] || 'HLV'}</div>
          </div>
          <ul className="list comments">
            {list.length === 0 && <li className="empty">Chưa có bình luận. Các HLV trao đổi về tình huống này ở đây.</li>}
            {list.map((c) => {
              const mine = c.author === me
              const can = mine || canEdit
              return (
                <li key={c.id} className="cmt">
                  <div className="cmt-h">
                    <b>{profiles[c.author] || 'Ẩn danh'}</b> <span className="muted">{new Date(c.createdAt).toLocaleString('vi-VN')}{c.editedAt ? ' · đã sửa' : ''}</span>
                    {can && editId !== c.id && (
                      <span className="cmt-acts">
                        <button className="icon-btn" title="Sửa bình luận" onClick={() => startEdit(c.id, c.text)}>✎</button>
                        <button className="icon-btn" title="Xoá bình luận" onClick={() => void remove(c.id)}>🗑</button>
                      </span>
                    )}
                  </div>
                  {editId === c.id ? (
                    <div className="stack">
                      <AutoTextarea minRows={2} maxHeight={200} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditId(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } }} />
                      <div className="row"><button className="btn sm" onClick={() => setEditId(null)}>Huỷ</button><button className="btn sm primary" disabled={!draft.trim()} onClick={saveEdit}>Lưu</button></div>
                    </div>
                  ) : <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>}
                </li>
              )
            })}
          </ul>
          <div className="row cmt-input">
            <AutoTextarea
              minRows={1}
              maxHeight={140}
              placeholder="Viết bình luận… (Enter để gửi, Shift+Enter xuống dòng)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            />
            <button className="btn primary sm" onClick={send}>Gửi</button>
          </div>
        </>
      )}
    </Panel>
  )
}
