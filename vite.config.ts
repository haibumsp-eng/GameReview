import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * onnxruntime-web (Whisper) kéo theo các file .wasm ~15–28 MB vào bản build, nhưng lúc chạy
 * transformers.js tải chúng từ CDN theo đúng phiên bản (không dùng bản trong bản build).
 * Bỏ khỏi bản build để dưới giới hạn 25 MiB mỗi file của Cloudflare Pages.
 */
function dropOnnxWasm(): Plugin {
  return {
    name: 'drop-onnx-wasm',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'asset' && /ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), dropOnnxWasm()],
  // ffmpeg.wasm dùng web worker nên không để Vite tiền xử lý.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@huggingface/transformers'] },
  // Whisper chạy trong worker dạng ES module.
  worker: { format: 'es' },
})
