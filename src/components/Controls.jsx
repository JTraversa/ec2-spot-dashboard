import { exportCSV, exportJSON } from '../utils/export'

// Range (visible window) and resolution (bar size) are independent controls —
// the chart loads the full per-instance history, so any combination is valid.
const RANGES = [
  { label: '1W', range: 7 },
  { label: '1M', range: 30 },
  { label: '3M', range: 90 },
  { label: '1Y', range: 365 },
  { label: 'ALL', range: 'all' },
]

const RESOLUTIONS = [
  { label: 'D', value: 'daily' },
  { label: 'W', value: 'weekly' },
  { label: 'M', value: 'monthly' },
]

const INDICATORS = [
  { key: 'sma7', label: 'SMA 7' },
  { key: 'sma30', label: 'SMA 30' },
  { key: 'sma90', label: 'SMA 90' },
  { key: 'bb', label: 'Bollinger' },
]

// Regions come from each provider's meta.json (whatever the collectors
// published), so a region added upstream appears here without a code change.
// The original three per cloud are pinned first; labels below are cosmetic.
const PINNED_REGIONS = {
  aws:   ['us-east-1', 'us-west-2', 'eu-west-1'],
  gcp:   ['us-central1', 'us-east4', 'europe-west4'],
  azure: ['us-east', 'us-west-2', 'eu-west'],
}
const REGION_LABELS = {
  'us-east': 'US East', 'us-west-2': 'US West 2', 'eu-west': 'EU West', 'us-east-2': 'US East 2', 'us-central': 'US Central',
  'eu-north': 'EU North', 'asia-southeast': 'Asia Southeast', 'japan-east': 'Japan East', 'uk-south': 'UK South',
}
function regionOptions(provider, meta) {
  const pinned = PINNED_REGIONS[provider] || []
  const known = Object.keys((meta && meta[provider]) || {})
  const all = [...pinned, ...known.filter(r => !pinned.includes(r)).sort()]
  return all.map(r => ({ value: r, label: provider === 'azure' ? (REGION_LABELS[r] || r) : r }))
}

const PROVIDERS = [
  { value: 'aws', label: 'AWS' },
  { value: 'gcp', label: 'GCP' },
  { value: 'azure', label: 'Azure' },
]

export default function Controls({
  provider, setProvider,
  region, setRegion,
  chartType, setChartType,
  timeRange, setTimeRange,
  granularity, setGranularity,
  activeIndicators, toggleIndicator,
  exportData, currentInstance, isS3, meta,
}) {
  const regions = regionOptions(provider, meta)

  return (
    <div className="controls">
      <div className="control-group">
        <label>Cloud</label>
        <div className="btn-group">
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              className={provider === p.value ? 'active' : ''}
              onClick={() => setProvider(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Region</label>
        <select value={region} onChange={e => setRegion(e.target.value)}>
          {regions.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label>Chart Type</label>
        <div className="btn-group">
          {['line', 'area'].map(t => (
            <button key={t} className={chartType === t ? 'active' : ''} onClick={() => setChartType(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Time Range</label>
        <div className="btn-group">
          {RANGES.map(r => (
            <button
              key={r.label}
              className={timeRange === r.range ? 'active' : ''}
              disabled={isS3}
              onClick={() => setTimeRange(r.range)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Resolution</label>
        <div className="btn-group">
          {RESOLUTIONS.map(r => (
            <button
              key={r.value}
              className={granularity === r.value ? 'active' : ''}
              disabled={isS3}
              onClick={() => setGranularity(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Indicators</label>
        <div className="btn-group">
          {INDICATORS.map(ind => (
            <button
              key={ind.key}
              className={activeIndicators.has(ind.key) ? 'active' : ''}
              disabled={isS3}
              onClick={() => toggleIndicator(ind.key)}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Export</label>
        <div className="btn-group">
          <button disabled={isS3} onClick={() => exportCSV(exportData(), currentInstance, region)}>CSV</button>
          <button disabled={isS3} onClick={() => exportJSON(exportData(), currentInstance, region)}>JSON</button>
        </div>
      </div>
    </div>
  )
}
