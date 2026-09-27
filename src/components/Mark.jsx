// The corpusAI mark for UI use (design-system.md section 4): a ring and a
// square on a 24-unit grid, stroke 1.4, ink ring, signal-green square.
export default function Mark({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="#111111" strokeWidth="1.4" />
      <rect x="8.5" y="8.5" width="7" height="7" fill="#1cc744" />
    </svg>
  )
}
