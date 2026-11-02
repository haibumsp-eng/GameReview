import { useState } from 'react'
import { useData, useUi } from '../store'
import { parseYouTubeId } from '../util'
import { Panel } from './Panel'

export function Library() {
  const { squads, games, addSquad, addGame, removeGame, addMember } = useData()
  const { squadId, gameId, set } = useUi()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')

  const squadGames = games.filter((g) => g.squadId === squadId)

  const submit = () => {
    const id = parseYouTubeId(url)
    if (!id) return setErr('Link YouTube không hợp lệ')
    const gid = addGame({ squadId, title: title.trim() || 'Trận mới', date, youtubeId: id })
    set({ gameId: gid, clipId: null })
    setAdding(false); setTitle(''); setUrl(''); setErr('')
  }

  return (
    <Panel
      title="Thư viện"

      actions={<button className="btn sm" disabled={!squadId} onClick={() => setAdding((v) => !v)}>+ Trận</button>}
    >
      <label className="field-label">Tuyến đội</label>
      <div className="row">
        <select
          value={squadId}
          onChange={(e) => set({ squadId: e.target.value, gameId: null, clipId: null })}
        >
          {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          className="btn sm"
          title="Mời HLV vào tuyến này (theo email)"
          disabled={!squadId}
          onClick={async () => {
            const email = prompt('Email của HLV (người đó phải đăng ký tài khoản trước):')
            if (!email?.trim()) return
            const role = prompt('Vai trò: coach (sửa được) hoặc viewer (chỉ xem)', 'coach') || 'coach'
            const err = await addMember(squadId, email.trim(), role.trim())
            alert(err ?? 'Đã thêm thành viên.')
          }}
        >👤</button>
        <button
          className="btn sm"
          title="Thêm tuyến đội"
          onClick={() => {
            const n = prompt('Tên tuyến đội (vd: U14 Nữ)')
            if (n?.trim()) set({ squadId: addSquad(n.trim()), gameId: null, clipId: null })
          }}
        >+</button>
      </div>

      {adding && (
        <div className="card stack">
          <input placeholder="Tên trận (vd: vs Hà Nội, vòng 3)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Link YouTube (unlisted)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {err && <div className="err">{err}</div>}
          <button className="btn primary" onClick={submit}>Thêm trận</button>
        </div>
      )}

      <label className="field-label">Trận đấu ({squadGames.length})</label>
      <ul className="list">
        {squadGames.length === 0 && <li className="empty">Chưa có trận. Bấm “+ Trận” và dán link YouTube.</li>}
        {squadGames.map((g) => (
          <li
            key={g.id}
            className={g.id === gameId ? 'item active' : 'item'}
            onClick={() => set({ gameId: g.id, clipId: null })}
          >
            <div>
              <div className="item-title">{g.title}</div>
              <div className="muted">{g.date}</div>
            </div>
            <button
              className="icon-btn"
              title="Xoá trận"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Xoá “${g.title}” cùng toàn bộ mark?`)) {
                  removeGame(g.id)
                  if (g.id === gameId) set({ gameId: null, clipId: null })
                }
              }}
            >×</button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
