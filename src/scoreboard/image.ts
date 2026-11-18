/** Đọc ảnh logo, thu nhỏ còn tối đa 160px (giữ nền trong suốt) và trả về data URL nhỏ gọn. */
export async function fileToLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Hãy chọn một file ảnh (PNG, JPG, WEBP, SVG).')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Không đọc được ảnh này.')); i.src = url })
    for (const max of [160, 120, 80]) {
      const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max))
      const w = Math.max(1, Math.round((img.naturalWidth || max) * k)), h = Math.max(1, Math.round((img.naturalHeight || max) * k))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const png = c.toDataURL('image/png')
      if (png.length < 120000) return png
      const webp = c.toDataURL('image/webp', 0.85)
      if (webp.startsWith('data:image/webp') && webp.length < 120000) return webp
    }
    throw new Error('Ảnh quá phức tạp, hãy chọn ảnh đơn giản hơn.')
  } finally { URL.revokeObjectURL(url) }
}
