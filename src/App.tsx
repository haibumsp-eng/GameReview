import { useShallow } from 'zustand/react/shallow'
import { Logo } from './components/Logo'
import { useEffect, useRef, useState } from 'react'
import { useData, useUi, selectGame, myOrgRole, orgExpired } from './store'
import { OrgAdminModal, OrgMembersModal } from './components/Orgs'
import { goToClip } from './nav'
import { yt } from './youtube'
import { Library } from './components/Library'
import { Roster } from './components/Roster'
import { PlayerPanel } from './components/PlayerPanel'
import { Timeline } from './components/Timeline'
import { MarkPanel, markNow, markIn, markOut, setSelectedIn, setSelectedOut } from './components/MarkPanel'
import { ClipList, useFilteredClips } from './components/ClipList'
import { Comments } from './components/Comments'
import { StatsPanel } from './components/StatsPanel'
import { Login } from './components/Login'
import { Overview } from './components/Overview'
import { RecordHud } from './components/RecordHud'
import { SpotlightRunner } from './components/Spotlight'
import { Gutter, SplitV } from './components/Gutter'
import { useLayout, clamp } from './layout'

function Hotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ||
        (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'file'].includes((t as HTMLInputElement).type))
      if (typing) {
        if (e.key === 'Escape') t.blur() // Esc: thoát ô nhập để dùng phím tắt
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); yt.toggle() }
      else if (k === 'j' || k === 'arrowleft') yt.seek(yt.time() - 5)
      else if (k === 'l' || k === 'arrowright') yt.seek(yt.time() + 5)
      else if (k === 'a') markNow('ATK')
      else if (k === 'd') markNow('DEF')
      else if (k === 'i') (e.shiftKey ? setSelectedIn : markIn)()
      else if (k === 'o') (e.shiftKey ? setSelectedOut : markOut)()
      else if (k === 'escape') useUi.getState().set({ inPoint: null })
      else if (k === 'delete' || k === 'backspace') {
        const id = useUi.getState().clipId
        if (id) { useData.getState().removeClip(id); useUi.getState().set({ clipId: null }) }
      }
    }
    // Bấm vào khung YouTube sẽ kéo bàn phím vào trong đó; lấy lại ngay để phím tắt vẫn chạy.
    // Trình duyệt không phải lúc nào cũng báo sự kiện, nên kiểm tra thêm mỗi 0,1 giây.
    const reclaim = () => {
      const el = document.activeElement
      if (el instanceof HTMLIFrameElement) { el.blur(); window.focus() }
    }
    const onBlur = () => setTimeout(reclaim, 0)
    const iv = setInterval(reclaim, 100)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => { clearInterval(iv); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', onBlur) }
  }, [])
  return null
}

/** Phát lần lượt các đoạn đã lọc (qua nhiều hiệp), không cắt file thật. */
function PlaylistRunner() {
  const { playlist, clipId, videoId, time, pending, set } = useUi(useShallow((s) => ({ playlist: s.playlist, clipId: s.clipId, videoId: s.videoId, time: s.time, pending: s.pending, set: s.set })))
  const list = useFilteredClips()
  useEffect(() => {
    if (!playlist || pending) return // đang chờ video hiệp khác tải xong
    const i = list.findIndex((c) => c.id === clipId)
    if (i < 0) return set({ playlist: false })
    const c = list[i]
    if (c.videoId !== videoId) return
    if (time >= c.end) {
      const next = list[i + 1]
      if (next) goToClip(next, true)
      else { set({ playlist: false }); yt.pause() }
    } else if (time < c.start - 1) {
      yt.seek(c.start)
    }
  }, [time, playlist, clipId, videoId, pending, list, set])
  return null
}

export default function App() {
  const { ready, session, error, squads, games, playlists, isSuper, orgs, orgMembers, baseLoaded, init, signOut, loadGame, profiles } = useData()
  const { orgId, squadId, gameId, overview, inPoint, toastMsg, set } = useUi(useShallow((s) => ({ orgId: s.orgId, squadId: s.squadId, gameId: s.gameId, overview: s.overview, inPoint: s.inPoint, toastMsg: s.toast, set: s.set })))
  const [modal, setModal] = useState<'' | 'members' | 'orgs'>('')
  const landed = useRef(false)
  const L = useLayout()

  useEffect(() => { init() }, [init])
  // Trung tâm đang xem: HLV/chủ trung tâm luôn là trung tâm của mình; quản trị hệ thống chọn được.
  const myOrgId = orgMembers.find((m) => m.userId === session?.user.id)?.orgId ?? ''
  useEffect(() => {
    if (!isSuper) { if (myOrgId !== orgId) set({ orgId: myOrgId }) }
    else if (orgs.length && !orgs.some((o) => o.id === orgId)) {
      let saved = ''
      try { saved = localStorage.getItem('gr-org') ?? '' } catch { /* trình duyệt chặn lưu */ }
      set({ orgId: orgs.some((o) => o.id === saved) ? saved : orgs[0].id })
    }
  }, [isSuper, myOrgId, orgs, orgId, set])
  // Chọn tuyến đội đầu tiên của trung tâm khi chưa có / không còn tồn tại.
  useEffect(() => {
    const mine = squads.filter((s) => s.orgId === orgId)
    if (!mine.some((s) => s.id === squadId)) { set({ squadId: mine[0]?.id ?? '' }); selectGame(null) }
  }, [squads, orgId, squadId, set])
  useEffect(() => { loadGame(gameId) }, [gameId, loadGame])

  // Link chia sẻ: #g=<gameId>&p=<playlistId>
  const deep = useRef(new URLSearchParams(location.hash.slice(1)))
  useEffect(() => {
    const g = deep.current.get('g')
    const game = g ? games.find((x) => x.id === g) : undefined
    const sq = game && squads.find((s) => s.id === game.squadId)
    if (game && sq) { set({ orgId: sq.orgId, squadId: game.squadId }); selectGame(game.id); deep.current.delete('g') }
  }, [games, squads, set])
  // Tài khoản quản trị: mở thẳng màn hình tổng quan để chọn trận.
  useEffect(() => {
    if (isSuper && !landed.current && !deep.current.get('g')) { landed.current = true; set({ overview: true }) }
  }, [isSuper, set])
  useEffect(() => {
    const p = deep.current.get('p')
    const pl = p ? playlists.find((x) => x.id === p) : undefined
    if (pl) { set({ filter: { side: pl.side, playerIds: pl.playerIds, playType: pl.playType }, playlistId: pl.id }); deep.current.delete('p') }
  }, [playlists, set])

  if (!ready) return <div className="login muted">Đang tải…</div>
  if (!session) return <Login />

  const me = profiles[session.user.id] || session.user.email || ''
  const org = orgs.find((o) => o.id === orgId)
  const role = isSuper ? 'owner' : myOrgRole(orgId)
  const ROLE: Record<string, string> = { owner: 'Chủ trung tâm', coach: 'HLV', viewer: 'Chỉ xem' }

  // Tài khoản chưa thuộc trung tâm nào.
  if (baseLoaded && !isSuper && !myOrgId) {
    return (
      <div className="no-org">
        <div className="card stack">
          <Logo />
          <b>Tài khoản “{me}” chưa thuộc trung tâm nào.</b>
          <JoinByCode />
          <div className="muted small-note">Chưa có mã? Hỏi chủ trung tâm / CLB. Nếu bạn là chủ trung tâm mới, hãy liên hệ để được tạo trung tâm.</div>
          <div className="row">
            <button className="btn ghost" onClick={() => location.reload()}>Tải lại</button>
            <button className="btn ghost" onClick={signOut}>Đăng xuất</button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="app">
      <Hotkeys />
      <PlaylistRunner />
      <SpotlightRunner />
      <header className="topbar">
        <Logo />
        {isSuper ? (
          <select className="org-select" value={orgId} onChange={(e) => { set({ orgId: e.target.value }); try { localStorage.setItem('gr-org', e.target.value) } catch { /* bỏ qua */ } }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : org && <span className="org-pill">{org.name}<span className="role">{ROLE[role ?? ''] ?? ''}</span></span>}
        {isSuper && <button className="btn sm ghost" onClick={() => setModal('orgs')}>Quản lý trung tâm</button>}
        {(role === 'owner') && <button className="btn sm ghost" onClick={() => setModal('members')}>Thành viên</button>}
        <span className="spacer" />
        {error && <span className="banner" title="Bấm để ẩn" onClick={() => useData.setState({ error: '' })}>{error}</span>}
        <div className="keys-help">
          <button className="btn sm ghost">⌨ Phím tắt</button>
          <div className="keys-pop">
            <div><kbd>Space</kbd> Phát / dừng</div>
            <div><kbd>J</kbd> <kbd>L</kbd> Lùi / tới 5 giây</div>
            <div><kbd>A</kbd> Đánh dấu tấn công</div>
            <div><kbd>D</kbd> Đánh dấu phòng thủ</div>
            <div><kbd>I</kbd> Điểm vào · <kbd>O</kbd> Điểm ra</div>
            <div><kbd>⇧I</kbd> <kbd>⇧O</kbd> Sửa vào/ra tình huống đang chọn</div>
            <div><kbd>Esc</kbd> Huỷ / thoát ô nhập · <kbd>Del</kbd> Xoá mark</div>
          </div>
        </div>
        <button className="btn sm primary" onClick={() => set({ overview: true })}>Tất cả trận</button>
        <button className="btn sm ghost" title="Đưa các module về kích thước mặc định" onClick={L.reset}>Đặt lại bố cục</button>
        <span className="me">{me}</span>
        {isSuper && <span className="pill live">ADMIN</span>}
        <button className="btn sm ghost" onClick={signOut}>Đăng xuất</button>
      </header>
      {overview && <Overview />}
      {modal === 'members' && <OrgMembersModal onClose={() => setModal('')} />}
      {modal === 'orgs' && <OrgAdminModal onClose={() => setModal('')} />}
      {orgExpired(org) && <div className="expired-bar">Gói của {org?.name} đã hết hạn ngày {org?.expiresOn}: bạn vẫn xem được nhưng không thêm/sửa được. Liên hệ để gia hạn.</div>}
      <RecordHud />
      {toastMsg && inPoint == null && <div className="toast">{toastMsg}</div>}
      {inPoint != null && <div className="inpoint-flag">Đang chờ điểm Ra… bấm <kbd>O</kbd> để kết thúc, <kbd>Esc</kbd> để huỷ</div>}
      <div className="workspace">
        <div className="col" style={{ width: L.left }}>
          <SplitV frac={L.leftSplit} setFrac={(f) => L.set({ leftSplit: f })} top={<Library />} bottom={<Roster />} />
        </div>
        <Gutter dir="col" begin={() => L.left} move={(s, dx) => L.set({ left: clamp(s + dx, 200, 520) })} />

        <div className="col center">
          <div className="slot grow"><PlayerPanel /></div>
          <Gutter dir="row" begin={() => L.tlH} move={(s, _dx, dy) => L.set({ tlH: clamp(s - dy, 70, 400) })} />
          <div className="slot" style={{ height: L.tlH }}><Timeline /></div>
          <Gutter dir="row" begin={() => L.clipsH} move={(s, _dx, dy) => L.set({ clipsH: clamp(s - dy, 120, 700) })} />
          <div className="slot" style={{ height: L.clipsH }}><ClipList /></div>
        </div>

        <Gutter dir="col" begin={() => L.right} move={(s, dx) => L.set({ right: clamp(s - dx, 260, 700) })} />
        <div className="col" style={{ width: L.right }}>
          <SplitV frac={L.rightSplit} setFrac={(f) => L.set({ rightSplit: f })} top={<RightTop />} bottom={<Comments />} />
        </div>
      </div>
    </div>
  )
}

/** Ô nhập mã 6 số để vào trung tâm. */
function JoinByCode() {
  const joinOrg = useData((s) => s.joinOrg)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!/^\d{6}$/.test(code)) return setMsg('Mã gồm 6 chữ số.')
    setBusy(true); setMsg('')
    const err = await joinOrg(code)
    setBusy(false)
    if (err) setMsg(err)
  }
  return (
    <div className="stack">
      <div className="row">
        <input inputMode="numeric" maxLength={6} placeholder="Mã trung tâm (6 số)" className="code-input" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button className="btn primary" disabled={busy} onClick={go}>Tham gia</button>
      </div>
      {msg && <div className="err">{msg}</div>}
    </div>
  )
}

/** Cột phải phía trên: chuyển giữa Đánh dấu tình huống và Thống kê (box score). */
function RightTop() {
  const [tab, setTab] = useState<'mark' | 'stats'>(() => {
    try { return localStorage.getItem('gr-rtab') === 'stats' ? 'stats' : 'mark' } catch { return 'mark' }
  })
  const pick = (t: 'mark' | 'stats') => { setTab(t); try { localStorage.setItem('gr-rtab', t) } catch { /* bỏ qua */ } }
  return (
    <div className="rtop">
      <div className="seg-toggle rtabs">
        <button className={tab === 'mark' ? 'on' : ''} onClick={() => pick('mark')}>Đánh dấu</button>
        <button className={tab === 'stats' ? 'on' : ''} onClick={() => pick('stats')}>Thống kê</button>
      </div>
      {tab === 'mark' ? <MarkPanel /> : <StatsPanel />}
    </div>
  )
}
