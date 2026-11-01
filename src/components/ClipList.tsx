import { useData, useUi, matches } from '../store'
import { PLAY_TYPES } from '../types'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'

export function useFilteredClips() {
  const gameId = useUi((s) => s.gameId)
  const filter = useUi((s) => s.filter)
  const clips = useData((s) => s.clips)
  return clips
    .filter((c) => c.gameId === gameId && matches(c, filter))
    .sort((a, b) => a.start - b.start)
}

export function ClipList() {
  const { gameId, clipId, filter, squadId, playlist, set } = useUi()
  const players = useData((s) => s.players).filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)
  const allPlayers = useData((s) => s.players)
  const total = useData((s) => s.clips).filter((c) => c.gameId === gameId).length
  const list = useFilteredClips()

  const setFilter = (p: Partial<typeof filter>) => set({ filter: { ...filter, ...p }, playlist: false })
  const togglePlayer = (id: string) =>
    setFilter({ playerIds: filter.playerIds.includes(id) ? filter.playerIds.filter((x) => x !== id) : [...filter.playerIds, id] })
  const active = !!(filter.side || filter.playType || filter.playerIds.length)

  const startPlaylist = () => {
    if (!list.length) return
    set({ playlist: true, clipId: list[0].id })
    yt.seek(list[0].start)
    yt.play()
  }
  const label = (ids: string[]) =>
    ids.map((id) => allPlayers.find((p) => p.id === id)?.number).filter((n) => n !== undefined).map((n) => '#' + n).join(' ')

  return (
    <Panel
      title={`Tình huống (${list.length}${active ? ` / ${total}` : ''})`}
      area="clips"
      actions={
        playlist
          ? <button className="btn sm" onClick={() => { set({ playlist: false }); yt.pause() }}>■ Dừng playlist</button>
          : <button className="btn sm primary" disabled={!list.length} onClick={startPlaylist}>▶ Phát {active ? 'danh sách lọc' : 'tất cả'}</button>
      }
    >
      <div className="filters">
        <div className="seg-toggle">
          <button className={!filter.side ? 'on' : ''} onClick={() => setFilter({ side: null })}>Tất cả</button>
          <button className={filter.side === 'ATK' ? 'on atk' : ''} onClick={() => setFilter({ side: 'ATK' })}>Tấn công</button>
          <button className={filter.side === 'DEF' ? 'on def' : ''} onClick={() => setFilter({ side: 'DEF' })}>Phòng thủ</button>
        </div>
        <select value={filter.playType} onChange={(e) => setFilter({ playType: e.target.value })}>
          <option value="">Mọi loại</option>
          {PLAY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <div className="chips">
          {players.map((p) => (
            <button key={p.id} className={filter.playerIds.includes(p.id) ? 'chip on' : 'chip'} onClick={() => togglePlayer(p.id)} title={p.name}>{p.number}</button>
          ))}
        </div>
        {active && <button className="btn sm" onClick={() => set({ filter: { side: null, playerIds: [], playType: '' } })}>Xoá lọc</button>}
      </div>

      <ul className="list clips">
        {list.length === 0 && <li className="empty">{gameId ? 'Không có tình huống nào khớp.' : 'Chưa chọn trận.'}</li>}
        {list.map((c) => (
          <li
            key={c.id}
            className={c.id === clipId ? 'item active' : 'item'}
            onClick={() => { set({ clipId: c.id, playlist: false }); yt.seek(c.start) }}
          >
            <span className={`badge ${c.side}`}>{c.side === 'ATK' ? 'ATK' : 'DEF'}</span>
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
