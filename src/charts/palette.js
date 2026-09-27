// Chart colors from design-system.md section 8. The primary series (the price
// a chart is about) is ink; every other series takes the next slot in this
// fixed order, never cycled. Anything past slot 6 folds into OTHER.
export const PRIMARY = '#111111'
export const SLOTS = ['#2a78d6', '#eb6834', '#4a3aa7', '#eda100', '#e87ba4', '#12873b']
export const OTHER = '#8a8a8a'

// Chart furniture: white surface, light grid, muted text, rule-colored borders.
export const CHART_SURFACE = '#ffffff'
export const CHART_GRID = '#f0f0f0'
export const CHART_TEXT = '#555555'
export const CHART_BORDER = '#d4d4d4'

// Hex color plus alpha, for area fills.
export function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
