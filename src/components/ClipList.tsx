import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { useData, useUi, matches } from '../store'
import { ExportModal } from './ExportModal'
import { PLAY_TYPES } from '../types'
import { yt } from '../youtube'
import { goToClip } from '../nav'
import { fmt } from '../util'
import { Panel } from './Panel'

/** Các tình huống khớp bộ lọc, trong cả trận, xếp theo hiệp rồi theo thời gian. */
export function useFilteredClips() {
  const gameId = useUi((s) => s.gameId)
  const filter = useUi((s) => s.filter)
  const clips = useData((s) => s.clips)
  const videos = useData((s) => s.videos)
  const pos = new Map(videos.map((v) => [v.id, v.position]))
  return clips
    .filter((c) => c.gameId === gameId && matches(c, filter))
    .sort((a, b) => (pos.get(a.videoId) ?? 0) - (pos.get(b.videoId) ?? 0) || a.start - b.start)
}

export function ClipList() {
  const { gameId, clipId, filter, squadId, playlist, playlistId, set } = useUi(useShallow((s) => ({ gameId: s.gameId, clipId: s.clipId, filter: s.filter, squadId: s.squadId, playlist: s.playlist, playlistId: s.playlistId, set: s.set })))
  const { playlists, addPlaylist, removePlaylist } = useData()
  const players = useData((s) => s.players).filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)
  const allPlayers = useData((s) => s.players)
  const total = useData((s) => s.clips).filter((c) => c.gameId === gameId).length
  const list = useFilteredClips()
  const videos = useData((s) => s.videos).filter((v) => v.gameId === gameId)
  const gameClips = useData((s) => s.clips).filter((c) => c.gameId === gameId)
  const typeOptions = [...new Set([...gameClips.map((c) => c.playType).filter(Boolean), ...PLAY_TYPES])]
  const [exporting, setExporting] = useState(false)
  const plName = playlists.find((x) => x.id === playlistId)?.name

  const setFilter = (p: Partial<typeof filter>) => set({ filter: { ...filter, ...p }, playlist: false, playlistId: '' })
  const togglePlayer = (id: string) =>
    setFilter({ playerIds: filter.playerIds.includes(id) ? filter.playerIds.filter((x) => x !== id) : [...filter.playerIds, id] })
  const active = !!(filter.side || filter.playType || filter.playerIds.length)

  const startPlaylist = () => {
    if (!list.length) return
    set({ playlist: true })
    goToClip(list[0], true)
  }
  const label = (ids: string[]) =>
    ids.map((id) => allPlayers.find((p) => p.id === id)).filter((p) => !!p).map((p) => `#${p!.number} ${p!.name}`).join(', ')

  return (
    <Panel
      title={`Tình huống (${list.length}${active ? ` / ${total}` : ''})`}

      actions={
        <>
        <button className="btn sm" disabled={!list.length} onClick={() => setExporting(true)} title="Cắt video từ file gốc ngay trên máy bạn">⬇ Tải video</button>
        {playlist
          ? <button className="btn sm" onClick={() => { set({ playlist: false }); yt.pause() }}>■ Dừng playlist</button>
          : <button className="btn sm primary" disabled={!list.length} onClick={startPlaylist}>▶ Phát {active ? 'danh sách lọc' : 'tất cả'}</button>}
        </>
      }
    >
      {exporting && <ExportModal clips={list} videos={videos} title={plName ?? (active ? 'Tình huống đã lọc' : 'Tất cả tình huống')} onClose={() => setExporting(false)} />}
      <div className="filters">
        {playlists.length > 0 && (
          <div className="row">
            <select
              value={playlistId}
              onChange={(e) => {
                const pl = playlists.find((x) => x.id === e.target.value)
                if (pl) set({ filter: { side: pl.side, playerIds: pl.playerIds, playType: pl.playType }, playlistId: pl.id, playlist: false })
                else set({ playlistId: '' })
              }}
            >
              <option value="">Playlist đã lưu ({playlists.length})</option>
              {playlists.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button
              className="btn sm"
              title="Copy link chia sẻ"
              disabled={!playlistId}
              onClick={() => {
                const url = `${location.origin}${location.pathname}#g=${gameId}&p=${playlistId}`
                navigator.clipboard?.writeText(url).then(() => alert('Đã copy link. HLV cùng tuyến đăng nhập là mở được.'))
              }}
            >🔗</button>
            <button
              className="btn sm"
              title="Xoá playlist"
              disabled={!playlistId}
              onClick={() => { if (confirm('Xoá playlist này?')) { removePlaylist(playlistId); set({ playlistId: '' }) } }}
            >×</button>
          </div>
        )}
        <div className="seg-toggle">
          <button className={!filter.side ? 'on' : ''} onClick={() => setFilter({ side: null })}>Tất cả</button>
          <button className={filter.side === 'ATK' ? 'on atk' : ''} onClick={() => setFilter({ side: 'ATK' })}>Tấn công</button>
          <button className={filter.side === 'DEF' ? 'on def' : ''} onClick={() => setFilter({ side: 'DEF' })}>Phòng thủ</button>
        </div>
        <select value={filter.playType} onChange={(e) => setFilter({ playType: e.target.value })}>
          <option value="">Mọi loại</option>
          {typeOptions.map((t) => <option key={t}>{t}</option>)}
        </select>
        <div className="chips">
          {players.map((p) => (
            <button key={p.id} className={filter.playerIds.includes(p.id) ? 'chip on' : 'chip'} onClick={() => togglePlayer(p.id)} title={p.name}><b>{p.number}</b> {p.name}</button>
          ))}
        </div>
        {active && (
          <div className="row">
            <button className="btn sm" onClick={() => set({ filter: { side: null, playerIds: [], playType: '' }, playlist: false, playlistId: '' })}>Xoá lọc</button>
            <button
              className="btn sm primary"
              disabled={!gameId}
              onClick={() => {
                const name = prompt('Tên playlist (vd: Phòng thủ pick&roll)')?.trim()
                if (name && gameId) set({ playlistId: addPlaylist(gameId, name, filter) })
              }}
            >💾 Lưu playlist</button>
          </div>
        )}
      </div>

      <ul className="list clips">
        {list.length === 0 && <li className="empty">{gameId ? 'Không có tình huống nào khớp.' : 'Chưa chọn trận.'}</li>}
        {list.map((c) => (
          <li
            key={c.id}
            className={c.id === clipId ? 'item active' : 'item'}
            onClick={() => { set({ playlist: false }); goToClip(c) }}
          >
            <span className={`badge ${c.side}`}>{c.side === 'ATK' ? 'ATK' : 'DEF'}</span>
            {videos.length > 1 && <span className="tag">{videos.find((v) => v.id === c.videoId)?.label ?? '?'}</span>}
            <span className="mono">{fmt(c.start)}–{fmt(c.end)}</span>
            <span className="grow">
              {c.teamWide ? <b>Cả đội </b> : <b>{label(c.playerIds)} </b>}
              {c.playType && <span className="tag">{c.playType}</span>}
              <span className="muted"> {c.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
