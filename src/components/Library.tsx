import { useState } from 'react'
import { useData, useUi, selectGame } from '../store'
import { parseVideoLines, toLoginEmail } from '../util'
import { Panel } from './Panel'

export function Library() {
  const { squads, games, videos, addSquad, addGame, removeGame, addMember } = useData()
  const { squadId, gameId, set } = useUi()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [links, setLinks] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')

  const squadGames = games.filter((g) => g.squadId === squadId)
  const parsed = parseVideoLines(links)

  const submit = () => {
    if (!parsed.videos.length) return setErr('Hãy dán ít nhất một link YouTube.')
    if (parsed.bad.length) return setErr(`Dòng ${parsed.bad.join(', ')} không phải link YouTube hợp lệ.`)
    const { gameId: gid } = addGame({ squadId, title: title.trim() || 'Trận mới', date }, parsed.videos)
    selectGame(gid)
    setAdding(false); setTitle(''); setLinks(''); setErr('')
  }

  return (
    <Panel
      title="Thư viện"
      actions={
        <>
          <button className="btn sm" onClick={() => set({ overview: true })} title="Danh sách tất cả trận, có tìm kiếm">Tất cả trận</button>
          <button className="btn sm" disabled={!squadId} onClick={() => setAdding((v) => !v)}>+ Trận</button>
        </>
      }
    >
      <label className="field-label">Tuyến đội</label>
      <div className="row">
        <select
          value={squadId}
          onChange={(e) => { set({ squadId: e.target.value }); selectGame(null) }}
        >
          {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          className="btn sm"
          title="Mời HLV vào tuyến này (theo tên đăng nhập hoặc email)"
          disabled={!squadId}
          onClick={async () => {
            const email = prompt('Tên đăng nhập hoặc email của HLV (người đó phải đăng ký tài khoản trước):')
            if (!email?.trim()) return
            const role = prompt('Vai trò: coach (sửa được) hoặc viewer (chỉ xem)', 'coach') || 'coach'
            const err = await addMember(squadId, toLoginEmail(email), role.trim())
            alert(err ?? 'Đã thêm thành viên.')
          }}
        >👤</button>
        <button
          className="btn sm"
          title="Thêm tuyến đội"
          onClick={() => {
            const n = prompt('Tên tuyến đội (vd: U14 Nữ)')
            if (n?.trim()) { set({ squadId: addSquad(n.trim()) }); selectGame(null) }
          }}
        >+</button>
      </div>

      {adding && (
        <div className="card stack">
          <input placeholder="Tên trận (vd: vs Hà Nội, vòng 3)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="field-label">Link YouTube của các hiệp: mỗi dòng một link</label>
          <textarea
            rows={5}
            placeholder={'Hiệp 1: https://youtu.be/…\nHiệp 2: https://youtu.be/…\nHiệp 3: https://youtu.be/…\nHiệp 4: https://youtu.be/…\n(thêm dòng cho OT nếu có)'}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
          />
          <div className="muted">
            {parsed.videos.length ? `Nhận ${parsed.videos.length} video: ${parsed.videos.map((v) => v.label).join(', ')}` : 'Chỉ có 1 video cho cả trận thì dán 1 link.'}
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" onClick={submit}>Thêm trận</button>
        </div>
      )}

      <label className="field-label">Trận đấu ({squadGames.length})</label>
      <ul className="list">
        {squadGames.length === 0 && <li className="empty">Chưa có trận. Bấm “+ Trận” và dán link YouTube.</li>}
        {squadGames.map((g) => {
          const n = videos.filter((v) => v.gameId === g.id).length
          return (
            <li
              key={g.id}
              className={g.id === gameId ? 'item active' : 'item'}
              onClick={() => selectGame(g.id)}
            >
              <div>
                <div className="item-title">{g.title}</div>
                <div className="muted">{g.date}{n > 1 ? ` · ${n} hiệp` : ''}</div>
              </div>
              <button
                className="icon-btn"
                title="Xoá trận"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Xoá “${g.title}” cùng toàn bộ mark?`)) {
                    removeGame(g.id)
                    if (g.id === gameId) selectGame(null)
                  }
                }}
              >×</button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
