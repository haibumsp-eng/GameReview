/* Ghi video đang quay xuống ổ lưu trữ của trình duyệt (OPFS) theo từng đoạn nhỏ, để không dồn cả hiệp vào bộ nhớ RAM.
 * Chạy trong Web Worker vì "sync access handle" (ghi nhanh, an toàn khi treo) chỉ dùng được ở đây; iPhone Safari 15.2+ hỗ trợ. */
/* eslint-disable @typescript-eslint/no-explicit-any */
let handle: any = null
let pos = 0
const ctx = self as any

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.t === 'open') {
      const root = await (navigator as any).storage.getDirectory()
      const dir = await root.getDirectoryHandle('rec', { create: true })
      const fh = await dir.getFileHandle(m.name, { create: true })
      handle = await fh.createSyncAccessHandle()
      handle.truncate(0); pos = 0
      ctx.postMessage({ t: 'opened', id: m.id })
    } else if (m.t === 'write') {
      const n = handle.write(new Uint8Array(m.buf), { at: pos })
      pos += n
      handle.flush()
      ctx.postMessage({ t: 'wrote', id: m.id, pos })
    } else if (m.t === 'close') {
      try { handle.flush() } catch { /* đã đóng */ }
      try { handle.close() } catch { /* đã đóng */ }
      handle = null
      ctx.postMessage({ t: 'closed', id: m.id })
    }
  } catch (err) {
    ctx.postMessage({ t: 'error', id: m.id, msg: String((err as Error)?.message ?? err) })
  }
}
