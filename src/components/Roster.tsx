import { useState } from 'react'
import { useData, useUi } from '../store'
import { Panel } from './Panel'

export function Roster() {
  const { players, addPlayer, removePlayer } = useData()
  const squadId = useUi((s) => s.squadId)
  const [num, setNum] = useState('')
  const [name, setName] = useState('')
  const list = players.filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)

  const add = () => {
    const n = parseInt(num, 10)
    if (isNaN(n) || !name.trim()) return
    addPlayer(squadId, n, name.trim())
    setNum(''); setName('')
  }

  return (
    <Panel title="Cầu thủ" area="roster">
      <div className="row">
        <input className="num" placeholder="#" value={num} onChange={(e) => setNum(e.target.value)} />
        <input
          placeholder="Tên"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn sm" onClick={add}>+</button>
      </div>
      <ul className="list">
        {list.map((p) => (
          <li key={p.id} className="item">
            <span><b className="jersey">{p.number}</b> {p.name}</span>
            <button className="icon-btn" onClick={() => confirm(`Xoá ${p.name}?`) && removePlayer(p.id)}>×</button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
