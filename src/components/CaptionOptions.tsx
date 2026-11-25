import { useUi, setCaption } from '../store'

const HOLDS: { v: number; label: string }[] = [
  { v: 0, label: 'Không dừng' }, { v: 3, label: '3 giây' }, { v: 5, label: '5 giây' }, { v: 8, label: '8 giây' }, { v: 12, label: '12 giây' }, { v: -1, label: 'Tự tính theo độ dài' },
]

/** Cài đặt hiển thị lời nhận xét trên video: dừng bao lâu để đọc, và thẻ ở góc sau đó ra sao. */
export function CaptionOptions({ showToggle = false }: { showToggle?: boolean }) {
  const caption = useUi((s) => s.caption)
  return (
    <div className="cap-opts stack">
      {showToggle && (
        <label className="row tight">
          <input type="checkbox" checked={caption.on} onChange={(e) => setCaption({ ...caption, on: e.target.checked })} />
          <b>Hiện nhận xét của HLV trên video</b>
        </label>
      )}
      <div className={`cap-grid ${caption.on ? '' : 'off'}`}>
        <label>Trước khi chạy tình huống, dừng hình để đọc
          <select value={caption.hold} disabled={!caption.on} onChange={(e) => setCaption({ ...caption, hold: +e.target.value })}>
            {HOLDS.map((h) => <option key={h.v} value={h.v}>{h.label}</option>)}
          </select>
        </label>
        <label>Khi tình huống đang chạy, thẻ ở góc
          <select value={caption.after} disabled={!caption.on} onChange={(e) => setCaption({ ...caption, after: e.target.value as 'compact' | 'full' | 'hide' })}>
            <option value="compact">Thu gọn (tên cầu thủ, loại tình huống)</option>
            <option value="full">Giữ cả lời nhận xét</option>
            <option value="hide">Ẩn</option>
          </select>
        </label>
      </div>
      <div className="muted small-note">Lời nhận xét hiện <b>đầy đủ</b> ở giữa khung video lúc dừng hình, chữ tự co để vừa khung, dài bao nhiêu cũng hiện hết.</div>
    </div>
  )
}
