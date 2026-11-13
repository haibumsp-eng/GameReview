import { create } from 'zustand'

/** Các model Whisper chạy trong trình duyệt. Dung lượng là ước lượng, tải 1 lần rồi trình duyệt lưu cache. */
export const MODELS = {
  turbo: { id: 'onnx-community/whisper-large-v3-turbo', label: 'Large v3 Turbo: chính xác nhất (~1 GB, cần GPU)', gpu: true,
    dtype: { webgpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, wasm: 'q8' } },
  small: { id: 'onnx-community/whisper-small', label: 'Small: khá (~250–400 MB)', gpu: false,
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
  base: { id: 'onnx-community/whisper-base', label: 'Base: nhanh, kém tiếng Việt (~80–200 MB)', gpu: false,
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
} as const
export type ModelKey = keyof typeof MODELS

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator

interface AsrState {
  model: ModelKey
  status: 'off' | 'loading' | 'ready' | 'error'
  progress: number
  loadedMB: number
  totalMB: number
  device: 'webgpu' | 'wasm' | null
  error: string
}
const saved = (() => { try { return localStorage.getItem('gr-voice-model') as ModelKey | null } catch { return null } })()
export const useAsr = create<AsrState>(() => ({
  model: saved && saved in MODELS ? saved : hasWebGPU() ? 'turbo' : 'small',
  status: 'off', progress: 0, loadedMB: 0, totalMB: 0, device: null, error: '',
}))

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (r: { text?: string; error?: string; ms?: number }) => void>()
let readyWaiters: ((ok: boolean) => void)[] = []

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') useAsr.setState({ progress: m.progress, loadedMB: m.loaded / 1e6, totalMB: m.total / 1e6 })
    else if (m.type === 'ready') { useAsr.setState({ status: 'ready', device: m.device, progress: 100 }); readyWaiters.forEach((f) => f(true)); readyWaiters = [] }
    else if (m.type === 'error') { useAsr.setState({ status: 'error', error: m.error }); readyWaiters.forEach((f) => f(false)); readyWaiters = [] }
    else if (m.type === 'result') { waiting.get(m.id)?.(m); waiting.delete(m.id) }
  }
  worker.onerror = (e) => { useAsr.setState({ status: 'error', error: e.message || 'Worker lỗi' }); readyWaiters.forEach((f) => f(false)); readyWaiters = [] }
  return worker
}

export function setModel(model: ModelKey) {
  try { localStorage.setItem('gr-voice-model', model) } catch { /* bỏ qua */ }
  useAsr.setState({ model, status: 'off', progress: 0, error: '' })
  worker?.terminate(); worker = null
}

/** Tải model (nếu chưa). Trả về true khi sẵn sàng. */
export function loadModel(): Promise<boolean> {
  const s = useAsr.getState()
  if (s.status === 'ready') return Promise.resolve(true)
  const p = new Promise<boolean>((res) => readyWaiters.push(res))
  if (s.status !== 'loading') {
    const m = MODELS[s.model]
    const device = hasWebGPU() ? 'webgpu' : 'wasm'
    useAsr.setState({ status: 'loading', progress: 0, error: '', loadedMB: 0, totalMB: 0 })
    getWorker().postMessage({ type: 'load', model: m.id, device, dtype: m.dtype[device] })
  }
  return p
}

export async function transcribe(audio: Float32Array): Promise<{ text?: string; error?: string; ms?: number }> {
  if (!(await loadModel())) return { error: useAsr.getState().error || 'Không tải được model' }
  const id = ++seq
  return new Promise((res) => { waiting.set(id, res); getWorker().postMessage({ type: 'run', id, audio }, [audio.buffer]) })
}

/* ---------- Thu âm từ mic ---------- */
let stream: MediaStream | null = null
let rec: MediaRecorder | null = null
let chunks: Blob[] = []

export async function startRecording(): Promise<string | null> {
  try {
    if (!stream || stream.getTracks().every((t) => t.readyState === 'ended'))
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  } catch {
    return 'Không mở được mic: hãy cho phép trình duyệt dùng micro.'
  }
  chunks = []
  rec = new MediaRecorder(stream)
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  rec.start()
  return null
}

/** Dừng thu, trả về âm thanh 16 kHz mono cho Whisper. */
export function stopRecording(): Promise<Float32Array | null> {
  return new Promise((res) => {
    if (!rec || rec.state === 'inactive') return res(null)
    rec.onstop = async () => {
      try {
        const buf = await new Blob(chunks, { type: rec?.mimeType }).arrayBuffer()
        const ctx = new AudioContext({ sampleRate: 16000 })
        const audio = await ctx.decodeAudioData(buf)
        ctx.close()
        res(audio.duration < 0.3 ? null : audio.getChannelData(0).slice())
      } catch { res(null) }
    }
    rec.stop()
  })
}

export function releaseMic() {
  stream?.getTracks().forEach((t) => t.stop()); stream = null
}
