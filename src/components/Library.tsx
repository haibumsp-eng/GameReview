import { useState } from 'react'
import { useData, useUi, selectGame } from '../store'
import { defaultLabel, parseYouTubeId, toLoginEmail } from '../util'
import { Panel } from './Panel'

export function Library() {
  const { squads, games, videos, addSquad, addGame, removeGame, addMember } = useData()
  const { squadId, gameId, set } = useUi()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [links, setLinks] = useState<string[]>(['', '', '', ''])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')

  const squadGames = games.filter((g) => g.squadId === squadId)
  // Mỗi ô một hiệp; ô để trống thì bỏ qua.
  const slots = links.map((l, i) => ({ label: defaultLabel(i + 1), raw: l.trim(), id: parseYouTubeId(l) }))
  const filled = slots.filter((x) => x.raw)
  const bad = filled.filter((x) => !x.id)

  const submit = () => {
    if (!filled.length) return setErr('Hãy dán ít nhất một link YouTube (ô Hiệp 1).')
    if (bad.length) return setErr(`Link ở ô ${bad.map((x) => x.label).join(', ')} không phải link YouTube hợp lệ.`)
    const { gameId: gid } = addGame({ squadId, title: title.trim() || 'Trận mới', date }, filled.map((x) => ({ label: x.label, youtubeId: x.id! })))
    selectGame(gid)
    setAdding(false); setTitle(''); setLinks(['', '', '', '']); setErr('')
  }

  return (
    <Panel
      title="Thư viện"
      actions={
        <>
          <button className="btn sm" onClick={() => set({ overview: true })} title="Danh sách tất cả trận, có tìm kiếm">Tất cả trận</button>
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

      <label className="field-label">Trận đấu ({squadGames.length})</label>
      <ul className="list">
        {squadGames.length === 0 && <li className="empty">Chưa có trận. Bấm nút xanh “+ Thêm trận” bên dưới.</li>}
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
      {adding && (
        <div className="card stack" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}>
          <input placeholder="Tên trận (vd: vs Hà Nội, vòng 3)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="field-label">Link YouTube từng hiệp (dán vào đúng ô, ô nào không có thì để trống)</label>
          {slots.map((x, i) => (
            <div key={i} className="link-row">
              <span className="link-label">{x.label}</span>
              <input
                placeholder={i === 0 ? 'Dán link YouTube… (cả trận 1 video thì chỉ dán ô này)' : 'Dán link YouTube…'}
                value={links[i]}
                onChange={(e) => setLinks(links.map((v, j) => (j === i ? e.target.value : v)))}
              />
              <span className={`link-ok ${x.raw ? (x.id ? 'ok' : 'bad') : ''}`}>{x.raw ? (x.id ? '✓' : '✗') : ''}</span>
            </div>
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => setLinks([...links, ''])}>+ Thêm OT</button>
            {links.length > 4 && <button className="btn sm" onClick={() => setLinks(links.slice(0, -1))}>− Bớt OT</button>}
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row">
            <button className="btn" onClick={() => { setAdding(false); setErr('') }}>Huỷ</button>
            <button className="btn primary grow-btn" onClick={submit}>Lưu trận</button>
          </div>
        </div>
      )}

      {!adding && squadId && (
        <button className="btn add-game" onClick={() => setAdding(true)}>+ Thêm trận</button>
      )}
    </Panel>
  )
}
