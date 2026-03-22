function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCSV(rows, instance, region) {
  if (rows.length === 0) return
  const headers = ['date', 'instance_type', 'region', 'open', 'high', 'low', 'close', 'avg']
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => r[h]).join(','))].join('\n')
  downloadFile(csv, `spot_prices_${instance}_${region}.csv`, 'text/csv')
}

export function exportJSON(rows, instance, region) {
  if (rows.length === 0) return
  downloadFile(JSON.stringify(rows, null, 2), `spot_prices_${instance}_${region}.json`, 'application/json')
}
