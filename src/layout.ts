import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface LayoutState {
  left: number // độ rộng cột trái (px)
  right: number // độ rộng cột phải (px)
  leftSplit: number // tỉ lệ chiều cao Thư viện / Cầu thủ (0..1)
  rightSplit: number // tỉ lệ chiều cao Đánh dấu / Bình luận
  tlH: number // chiều cao Timeline (px)
  clipsH: number // chiều cao Tình huống (px)
  set: (p: Partial<LayoutState>) => void
  reset: () => void
}

const defaults = { left: 270, right: 360, leftSplit: 0.62, rightSplit: 0.6, tlH: 132, clipsH: 300 }

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({ ...defaults, set: (p) => set(p), reset: () => set(defaults) }),
    { name: 'gamereview-layout-v2' },
  ),
)

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
