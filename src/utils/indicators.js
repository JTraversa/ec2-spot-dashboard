export function calcSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j].value
    result.push({ time: data[i].time, value: sum / period })
  }
  return result
}

export function calcBollinger(data, period = 20, mult = 2) {
  const upper = [], lower = [], mid = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j].value
    const avg = sum / period
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) sumSq += (data[j].value - avg) ** 2
    const std = Math.sqrt(sumSq / period)
    mid.push({ time: data[i].time, value: avg })
    upper.push({ time: data[i].time, value: avg + mult * std })
    lower.push({ time: data[i].time, value: avg - mult * std })
  }
  return { upper, lower, mid }
}

const DAY_MS = 86400000
const dateToTs = t => new Date(t + 'T00:00:00Z').getTime()
const tsToDate = ts => new Date(ts).toISOString().slice(0, 10)

// Resample a sorted [{time:'YYYY-MM-DD', value}] series onto a uniform DAILY
// grid. lightweight-charts uses an ordinal (index-based) time axis — every
// point gets equal width regardless of the real time between it and its
// neighbour — so a series mixing sparse pre-2024 monthly points with dense
// 2024+ daily points renders with a wildly non-linear x-axis. Gridding to one
// point per calendar day makes the axis proportional to real time.
//
// Between two consecutive real points we LINEAR-INTERPOLATE the filled days.
// The fill is colinear with the straight segment the chart would draw anyway,
// so the line looks identical — just positioned correctly in time — and stays
// connected. Gaps longer than `breakGapDays` (default ~6 months) are emitted as
// "no data" whitespace instead, so a genuine multi-month hole (e.g. a retired-
// then-revived instance) shows as an honest, proportionally-sized blank rather
// than a fabricated long trend line. Interpolated days carry `interp: true`.
export function resampleProportional(data, breakGapDays = 183) {
  if (data.length < 2) return data
  const out = []
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i], b = data[i + 1]
    out.push({ time: a.time, value: a.value })
    const ta = dateToTs(a.time), tb = dateToTs(b.time)
    const gapDays = Math.round((tb - ta) / DAY_MS)
    if (gapDays <= 1) continue
    const bridge = gapDays <= breakGapDays
    for (let d = 1; d < gapDays; d++) {
      const time = tsToDate(ta + d * DAY_MS)
      if (bridge) out.push({ time, value: a.value + (b.value - a.value) * (d / gapDays), interp: true })
      else out.push({ time, value: undefined, noData: true })
    }
  }
  const last = data[data.length - 1]
  out.push({ time: last.time, value: last.value })
  return out
}
