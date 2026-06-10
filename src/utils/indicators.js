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

// `denseFrom` (a YYYY-MM-DD string) scopes gap-filling to the native dense
// series: daily/weekly charts can be prefixed with sparse pre-2024 monthly
// points, and filling those ~monthly gaps with "no data" whitespace would
// shred the old line into dots. Points dated before `denseFrom` are left as
// plain straight segments.
export function fillTimeGaps(data, gran, denseFrom = null) {
  if (data.length < 2) return data
  const filled = []
  const maxGapDays = gran === 'monthly' ? 90 : gran === 'weekly' ? 21 : 3

  for (let i = 0; i < data.length; i++) {
    filled.push(data[i])
    if (i < data.length - 1 && (!denseFrom || data[i].time >= denseFrom)) {
      const curr = new Date(data[i].time)
      const next = new Date(data[i + 1].time)
      const gapDays = (next - curr) / (1000 * 60 * 60 * 24)
      if (gapDays > maxGapDays) {
        const step = new Date(curr)
        while (true) {
          if (gran === 'monthly') step.setUTCMonth(step.getUTCMonth() + 1)
          else if (gran === 'weekly') step.setUTCDate(step.getUTCDate() + 7)
          else step.setUTCDate(step.getUTCDate() + 1)
          if (step >= next) break
          filled.push({ time: step.toISOString().slice(0, 10), value: undefined, noData: true })
        }
      }
    }
  }
  return filled
}
