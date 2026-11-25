import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useData, useUi, toast } from '../store'
import { confirmDialog, promptDialog } from '../lib/dialog'

interface Snap { id: string; kind: 'auto' | 'manual' | 'restore'; label: string; created_at: string; author: string | null; summary: { home?: number; away?: number; players?: number; stats?: number; lineups?: number } }
const KIND: Record<Snap['kind'], string> = { auto: 'Tự động', manual: 'Lưu tay', restore: 'Trước khi khôi phục' }

/**
 * Khôi phục trận (cầu thủ, các pha thống kê, thay người) về một bản đã lưu.
 * Server tự lưu một bản trước khi có thay đổi (cách nhau tối thiểu 5 phút) và bạn có thể lưu tay.
 * Khôi phục xong, trạng thái ngay trước đó cũng được lưu thành một bản nên có thể hoàn lại.
 */
export function SnapshotsModal({ onClose }: { onClose: () => void }) {
  const gameId = useUi((s) => s.gameId)
  const game = useData((s) => s.games.find((g) => g.id === gameId))
  const { stats, lineups, gamePlayers, profiles } = useData()
  const [list, setList] = useState<Snap[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!gameId) return
    const { data, error } = await supabase.from('game_snapshots').select('id, kind, label, created_at, author, summary').eq('game_id', gameId).order('created_at', { ascending: false }).limit(80)
    if (error) return setErr(error.message)
    setErr(''); setList((data ?? []) as Snap[])
  }
  useEffect(() => { void load() }, [gameId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const label = await promptDialog({ title: 'Lưu bản hiện tại', label: 'Tên bản lưu (tuỳ chọn)', placeholder: 'vd: Trước hiệp 2', okText: 'Lưu' })
    if (label === null || !gameId) return
    setBusy(true)
    const { data, error } = await supabase.rpc('game_snapshot_save', { p_game: gameId, p_label: label })
    setBusy(false)
    if (error || data !== 'ok') return setErr(error?.message ?? String(data))
    toast('Đã lưu bản hiện tại'); void load()
  }
  const restore = async (s: Snap) => {
    const ok = await confirmDialog({
      title: 'Khôi phục về bản này?',
      message: `Trận sẽ trở về trạng thái lúc ${fmt(s.created_at)}${s.summary.home != null ? ` (tỉ số ${s.summary.home}–${s.summary.away}, ${s.summary.stats ?? 0} pha)` : ''}. Hiện tại trận có ${stats.length} pha. Trạng thái hiện tại sẽ được lưu lại thành một bản trước khi khôi phục, nên bạn có thể hoàn lại.`,
      okText: 'Khôi phục', danger: true,
    })
    if (!ok || !gameId) return
    setBusy(true)
    const { data, error } = await supabase.rpc('game_snapshot_restore', { p_snapshot: s.id })
    setBusy(false)
    if (error || data !== 'ok') return setErr(error?.message ?? String(data))
    toast('Đã khôi phục trận về bản đã chọn'); onClose()
    void useData.getState().loadGame(gameId)
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const cur = { home: stats.reduce((a, e) => a + (e.side === 'home' ? ({ '2PM': 2, '3PM': 3, FTM: 1 } as Record<string, number>)[e.type] ?? 0 : 0), 0), away: stats.reduce((a, e) => a + (e.side === 'away' ? ({ '2PM': 2, '3PM': 3, FTM: 1 } as Record<string, number>)[e.type] ?? 0 : 0), 0) }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack snap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Khôi phục bản cũ · {game?.title}</b><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="muted small-note">
          Dùng khi có người bấm nhầm hoặc xoá nhầm. Chỉ khôi phục <b>dữ liệu Live Stats</b> của trận này (cầu thủ, pha thống kê, thay người). Mổ băng, bình luận và bảng tỉ số không bị đổi.
          Máy chủ tự lưu một bản trước khi có thay đổi (mỗi bản cách nhau ít nhất 5 phút).
        </div>
        <div className="snap-now">Hiện tại: tỉ số <b>{cur.home}–{cur.away}</b> · {stats.length} pha · {lineups.length} lần thay người · {gamePlayers.length} cầu thủ
          <button className="btn sm" disabled={busy} onClick={save}>+ Lưu bản hiện tại</button></div>
        {err && <div className="err">{err}</div>}
        <div className="snap-list">
          {list === null && !err && <div className="muted">Đang tải…</div>}
          {list?.length === 0 && <div className="muted">Chưa có bản lưu nào. Bản đầu tiên được tạo khi có thay đổi tiếp theo, hoặc bấm “Lưu bản hiện tại”.</div>}
          {list?.map((s) => (
            <div key={s.id} className="snap-row">
              <div className="grow">
                <b>{fmt(s.created_at)}</b> <span className={`tag snap-${s.kind}`}>{KIND[s.kind]}</span>{s.label && s.label !== KIND[s.kind] && <span className="muted"> · {s.label}</span>}
                <div className="muted small-note">Tỉ số {s.summary.home ?? 0}–{s.summary.away ?? 0} · {s.summary.stats ?? 0} pha · {s.summary.lineups ?? 0} thay người · {s.summary.players ?? 0} cầu thủ{s.author && profiles[s.author] ? ` · ${profiles[s.author]}` : ''}</div>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => restore(s)}>↺ Khôi phục</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
