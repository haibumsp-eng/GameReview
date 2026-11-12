/** Icon GameReview: quả bóng rổ (trắng) + nút play (lime) + thanh timeline. Vẽ vector, nét sắc ở mọi kích thước. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <circle cx="50" cy="44" r="36" />
        <path d="M50 8v20M50 60v20M14 44h23M69 44h17" />
        <path d="M25.3 21Q44.3 44 25.3 67M74.7 21Q55.7 44 74.7 67" />
      </g>
      <path d="M39.5 29.5v29l25.5-14.5z" stroke="#BEDF00" strokeWidth="4" strokeLinejoin="round" />
      <g stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
        <path d="M14 93h72M14 88v10M86 88v10M26 93v4M38 93v4M50 93v4M62 93v4M74 93v4" />
      </g>
    </svg>
  )
}

/** Logo đầy đủ: icon + chữ GAME (mảnh) REVIEW (đậm, lime). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="logo">
      <LogoMark size={size} />
      <span className="logo-word">GAME <b>REVIEW</b></span>
    </div>
  )
}
