/// <reference lib="webworker" />
// Chạy Whisper ngay trong trình duyệt (transformers.js + ONNX Runtime). Model tải 1 lần, trình duyệt tự lưu cache.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loadingKey = ''

type Msg =
  | { type: 'load'; model: string; device: 'webgpu' | 'wasm'; dtype: string | Record<string, string> }
  | { type: 'run'; id: number; audio: Float32Array; prompt?: string }

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.type === 'load') {
    const key = `${m.model}|${m.device}`
    if (loadingKey === key && asr) { postMessage({ type: 'ready', device: m.device }); return }
    loadingKey = key
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      asr = (await (pipeline as any)('automatic-speech-recognition', m.model, {
        device: m.device,
        dtype: m.dtype,
        progress_callback: (p: { status: string; progress?: number; loaded?: number; total?: number }) => {
          if (p.status === 'progress_total') postMessage({ type: 'progress', progress: p.progress ?? 0, loaded: p.loaded ?? 0, total: p.total ?? 0 })
        },
      })) as AutomaticSpeechRecognitionPipeline
      // Chạy nháp 1 lần để lần nói đầu tiên không bị chậm.
      await asr(new Float32Array(16000), { language: 'vietnamese', task: 'transcribe' })
      postMessage({ type: 'ready', device: m.device })
    } catch (err) {
      asr = null; loadingKey = ''
      postMessage({ type: 'error', error: String((err as Error)?.message ?? err) })
    }
  }
  if (m.type === 'run') {
    if (!asr) { postMessage({ type: 'result', id: m.id, error: 'Model chưa sẵn sàng' }); return }
    try {
      const t0 = performance.now()
      const out = await asr(m.audio, { language: 'vietnamese', task: 'transcribe' })
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
      postMessage({ type: 'result', id: m.id, text: text.trim(), ms: Math.round(performance.now() - t0) })
    } catch (err) {
      postMessage({ type: 'result', id: m.id, error: String((err as Error)?.message ?? err) })
    }
  }
}
