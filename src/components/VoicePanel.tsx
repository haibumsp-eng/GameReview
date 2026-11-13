import { useEffect, useMemo, useRef, useState } from 'react'
import type { TeamSide } from '../types'
import { yt } from '../youtube'
import { toast } from '../store'
import { dialogOpen } from '../lib/dialog'
import { STAT_LABEL } from '../lib/boxscore'
import { parseVoice, type VPlayer, type VoiceItem } from '../voice/parse'
import { MODELS, hasWebGPU, loadModel, releaseMic, setModel, startRecording, stopRecording, transcribe, useAsr, type ModelKey } from '../voice/asr'

export interface VoiceStamp { period: number; clockS: number; videoId: string | null; videoT: number | null }

interface Props {
  gameId: string
  homeName: string
  awayName: string
  players: VPlayer[]
  canEdit: boolean
  stamp: () => VoiceStamp
  onCommit: (items: VoiceItem[], stamp: VoiceStamp) => number
}

const wordsKey = (gameId: string) => `gr-voice-words-${gameId}`
function loadWords(gameId: string) {
  try { const v = JSON.parse(localStorage.getItem(wordsKey(gameId)) || 'null'); if (v?.home != null) return v as { home: string; away: string } } catch { /* bỏ qua */ }
  return { home: 'xanh', away: 'tím' }
}

const ALIAS_KEY = 'gr-voice-aliases'
const loadAliases = () => { try { return localStorage.getItem(ALIAS_KEY) ?? '' } catch { return '' } }
/** Mỗi dòng "nghe thành = hiểu là". */
const parseAliases = (txt: string): [string, string][] =>
  txt.split('\n').map((l) => l.split('=')).filter((x) => x.length === 2 && x[0].trim() && x[1].trim()).map(([a, b]) => [a.trim(), b.trim()])

/** Nói để ghi stats: giữ V (hoặc giữ nút mic) → nói → thả → kiểm tra → Enter để ghi. Whisper chạy ngay trong trình duyệt. */
export function VoicePanel({ gameId, homeName, awayName, players, canEdit, stamp, onCommit }: Props) {
  const asr = useAsr()
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy' | 'review'>('idle')
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const [words, setWords] = useState(() => loadWords(gameId))
  const [showSet, setShowSet] = useState(false)
  const [aliasText, setAliasText] = useState(loadAliases)
  const saveAliases = (v: string) => { setAliasText(v); try { localStorage.setItem(ALIAS_KEY, v) } catch { /* bỏ qua */ } }
  const [ms, setMs] = useState(0)
  const st = useRef<{ stamp: VoiceStamp | null; wasPlaying: boolean; holding: boolean; starting: boolean }>({ stamp: null, wasPlaying: false, holding: false, starting: false })

  useEffect(() => { setWords(loadWords(gameId)) }, [gameId])
  useEffect(() => () => releaseMic(), [])
  const saveWords = (w: { home: string; away: string }) => { setWords(w); try { localStorage.setItem(wordsKey(gameId), JSON.stringify(w)) } catch { /* bỏ qua */ } }

  const ctx = useMemo(() => ({
    homeWords: [words.home, homeName, 'đội nhà', 'home'].filter(Boolean),
    awayWords: [words.away, awayName, 'đội khách', 'away'].filter(Boolean),
    players,
    aliases: parseAliases(aliasText),
  }), [words, homeName, awayName, players, aliasText])
  const items = useMemo(() => (phase === 'review' ? parseVoice(text, ctx) : []), [phase, text, ctx])
  const keep = items.filter((_, i) => !removed.has(i))
  const okCount = keep.filter((it) => (it.kind === 'stat' && !it.error) || it.kind === 'clock').length

  const resume = () => { if (st.current.wasPlaying) yt.play(); st.current.wasPlaying = false }
  const finish = (commit: boolean) => {
    if (commit && st.current.stamp) {
      const n = onCommit(keep, st.current.stamp)
      if (n) toast(`Đã ghi ${n} pha bằng giọng nói`)
    }
    setPhase('idle'); setText(''); setRemoved(new Set()); resume()
  }

  const start = async () => {
    if (!canEdit || st.current.starting || phase === 'rec' || phase === 'busy') return
    if (phase === 'review') {
      // Nói tiếp khi chưa xác nhận: ghi luôn câu trước.
      if (st.current.stamp) { const n = onCommit(keep, st.current.stamp); if (n) toast(`Đã ghi ${n} pha`) }
      setText(''); setRemoved(new Set())
    } else {
      st.current.wasPlaying = yt.ready() && yt.playing()
    }
    st.current.stamp = stamp()
    if (yt.ready() && yt.playing()) yt.pause() // để tiếng video không lẫn vào mic
    if (useAsr.getState().status === 'off') loadModel()
    st.current.holding = true; st.current.starting = true
    const err = await startRecording()
    st.current.starting = false
    if (err) { toast(err); setPhase('idle'); resume(); return }
    setPhase('rec')
    if (!st.current.holding) stop() // thả phím trước khi mic kịp mở
  }
  const stop = async () => {
    st.current.holding = false
    if (st.current.starting) return
    setPhase('busy')
    const audio = await stopRecording()
    if (!audio) { setPhase('idle'); resume(); return }
    const r = await transcribe(audio)
    if (r.error) { toast(`Nhận giọng lỗi: ${r.error}`); setPhase('idle'); resume(); return }
    setMs(r.ms ?? 0)
    setText(r.text ?? ''); setRemoved(new Set()); setPhase('review')
  }

  // Giữ V để nói; Enter ghi, Esc bỏ.
  const live = useRef({ start, stop, finish, phase })
  live.current = { start, stop, finish, phase }
  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.classList.contains('vp-text') }
    const down = (e: KeyboardEvent) => {
      if (dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return
      const L = live.current
      if (e.key.toLowerCase() === 'v' && !typing(e) && !(e.target as HTMLElement).classList.contains('vp-text')) { e.preventDefault(); if (!e.repeat) L.start(); return }
      if (L.phase === 'review' && !typing(e)) {
        if (e.key === 'Enter') { e.preventDefault(); L.finish(true) }
        else if (e.key === 'Escape') { e.preventDefault(); L.finish(false) }
      }
    }
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'v' && st.current.holding) live.current.stop() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const side = (s: TeamSide | null) => (s === 'home' ? homeName : s === 'away' ? awayName : '?')
  const chip = (it: VoiceItem, i: number) => {
    const off = removed.has(i)
    const cls = it.kind === 'stat' ? (it.error ? 'bad' : it.warn ? 'warn' : '') : it.kind === 'note' ? 'note' : ''
    const label = it.kind === 'stat' ? <><span className={`st-dot ${it.side ?? ''}`} />{it.number != null ? `#${it.number} ` : ''}<b>{STAT_LABEL[it.type]}</b></>
      : it.kind === 'clock' ? <><b>{it.run ? '▶ Chạy giờ' : '❚❚ Dừng giờ'}</b></> : <>{it.text}</>
    const tip = it.kind === 'stat' ? [side(it.side), it.error, it.warn].filter(Boolean).join(' · ') : undefined
    return (
      <span key={i} className={`vp-chip ${cls} ${off ? 'off' : ''}`} title={tip}>
        {label}
        {it.kind === 'stat' && (it.error || it.warn) && <small>{it.error || it.warn}</small>}
        {it.kind !== 'note' && <button className="vp-x" onClick={() => setRemoved((r) => { const n = new Set(r); if (n.has(i)) n.delete(i); else n.add(i); return n })}>{off ? '↺' : '×'}</button>}
      </span>
    )
  }

  const statusText =
    asr.status === 'loading' ? `Đang tải model ${Math.round(asr.progress)}%${asr.totalMB ? ` (${Math.round(asr.loadedMB)}/${Math.round(asr.totalMB)} MB)` : ''}`
      : asr.status === 'error' ? 'Lỗi model' : asr.status === 'ready' ? `Whisper sẵn sàng · ${asr.device === 'webgpu' ? 'GPU' : 'CPU'}` : 'Model chưa tải'

  return (
    <div className={`vp ${phase}`}>
      <div className="vp-bar">
        <button className={`vp-mic ${phase === 'rec' ? 'rec' : ''}`} disabled={!canEdit}
          onPointerDown={(e) => { e.preventDefault(); start() }} onPointerUp={() => st.current.holding && stop()} onPointerLeave={() => st.current.holding && stop()}
          title="Giữ để nói (hoặc giữ phím V)">
          <span className="vp-dot" />{phase === 'rec' ? 'Đang nghe…' : phase === 'busy' ? 'Đang xử lý…' : 'Giữ để nói'} <kbd>V</kbd>
        </button>
        <span className={`vp-status ${asr.status}`} title={asr.error || undefined}>{statusText}</span>
        <button className="icon-btn" title="Cài đặt giọng nói" onClick={() => setShowSet(!showSet)}>⚙</button>
      </div>
      {asr.status === 'loading' && <div className="vp-prog"><i style={{ width: `${asr.progress}%` }} /></div>}

      {showSet && (
        <div className="vp-set">
          <label className="field-label">Model</label>
          <div className="row">
            <select value={asr.model} onChange={(e) => setModel(e.target.value as ModelKey)}>
              {(Object.keys(MODELS) as ModelKey[]).map((k) => <option key={k} value={k} disabled={MODELS[k].gpu && !hasWebGPU()}>{MODELS[k].label}</option>)}
            </select>
            <button className="btn sm" disabled={asr.status === 'loading' || asr.status === 'ready'} onClick={() => loadModel()}>{asr.status === 'ready' ? 'Đã tải' : 'Tải'}</button>
          </div>
          {asr.status === 'error' && <div className="err">{asr.error}</div>}
          <div className="vp-words">
            <label><span className="st-dot home" />{homeName} gọi là<input value={words.home} onChange={(e) => saveWords({ ...words, home: e.target.value })} placeholder="xanh" /></label>
            <label><span className="st-dot away" />{awayName} gọi là<input value={words.away} onChange={(e) => saveWords({ ...words, away: e.target.value })} placeholder="tím" /></label>
          </div>
          <label className="field-label">Sửa từ hay nghe sai · mỗi dòng: nghe thành = hiểu là</label>
          <textarea className="vp-alias" rows={4} value={aliasText} onChange={(e) => saveAliases(e.target.value)}
            placeholder={'shooting file = shooting foul\nsổ = số\nxin = xanh'} />
        </div>
      )}

      {phase === 'review' && (
        <div className="vp-review">
          <input className="vp-text" value={text} onChange={(e) => { setText(e.target.value); setRemoved(new Set()) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } }}
            title={ms ? `Nhận giọng mất ${(ms / 1000).toFixed(1)} giây` : undefined} />
          <div className="vp-chips">{items.length ? items.map(chip) : <span className="muted">Không nhận ra pha nào</span>}</div>
          <div className="row">
            <button className="btn sm ghost" onClick={() => finish(false)}>Bỏ <kbd>Esc</kbd></button>
            <button className="btn sm primary grow-btn" disabled={!okCount} onClick={() => finish(true)}>Ghi {okCount} <kbd>Enter</kbd></button>
          </div>
        </div>
      )}
    </div>
  )
}
