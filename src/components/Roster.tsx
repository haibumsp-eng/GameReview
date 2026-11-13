import { useState } from 'react'
import { useData, useUi } from '../store'
import { Panel } from './Panel'
import { confirmDialog } from '../lib/dialog'

export function Roster() {
  const { players, addPlayer, addPlayers, removePlayer } = useData()
  const squadId = useUi((s) => s.squadId)
  const [num, setNum] = useState('')
  const [name, setName] = useState('')
  const [bulk, setBulk] = useState(false)
  const [text, setText] = useState('')
  const list = players.filter((p) => p.squadId === squadId).sort((a, b) => a.number - b.number)

  const add = () => {
    const n = parseInt(num, 10)
    if (isNaN(n) || !name.trim()) return
    addPlayer(squadId, n, name.trim())
    setNum(''); setName('')
  }

  // Mỗi dòng: "số  tên" — ngăn cách bằng dấu cách, tab (dán từ Excel/Sheets), dấu phẩy, gạch hoặc dấu chấm.
  const existing = new Set(list.map((p) => p.number))
  const parsed = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^#?(\d{1,3})\s*[\t,;.\-–:]*\s*(.+)$/)
    return m ? { number: parseInt(m[1], 10), name: m[2].trim() } : null
  })
  const valid = parsed.filter((x): x is { number: number; name: string } => !!x && !existing.has(x.number))
  const bad = parsed.length - parsed.filter(Boolean).length
  const dup = parsed.filter((x) => x && existing.has(x.number)).length

  const importAll = () => {
    if (!valid.length) return
    addPlayers(squadId, valid)
    setText(''); setBulk(false)
  }

  return (
    <Panel
      title="Cầu thủ"

      actions={<button className="btn sm" onClick={() => setBulk((v) => !v)}>Nhập danh sách</button>}
    >
      {bulk && (
        <div className="card stack">
          <textarea
            rows={6}
            placeholder={'Mỗi dòng một cầu thủ: số áo rồi tên\n4 Minh\n5 Hùng\n7 Nam\n\n(Có thể dán thẳng 2 cột từ Excel / Google Sheets)'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="muted">
            {valid.length} cầu thủ hợp lệ
            {dup > 0 && ` · bỏ ${dup} dòng trùng số áo`}
            {bad > 0 && ` · ${bad} dòng không đọc được`}
          </div>
          <button className="btn primary" disabled={!valid.length} onClick={importAll}>Thêm {valid.length} cầu thủ</button>
        </div>
      )}
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
            <button className="icon-btn" onClick={async () => { if (await confirmDialog({ title: `Xoá #${p.number} ${p.name}?`, message: 'Cầu thủ sẽ bị gỡ khỏi danh sách của tuyến và khỏi các tình huống đã gắn.', okText: 'Xoá', danger: true })) removePlayer(p.id) }}>×</button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
