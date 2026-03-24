import { exportCSV, exportJSON } from '../utils/export'

const RANGES = [
  { label: '1W', range: 7, granularity: 'daily' },
  { label: '1M', range: 30, granularity: 'daily' },
  { label: '3M', range: 90, granularity: 'daily' },
  { label: '1Y', range: 365, granularity: 'weekly' },
  { label: 'ALL', range: 'all', granularity: 'weekly' },
]

const INDICATORS = [
  { key: 'sma7', label: 'SMA 7' },
  { key: 'sma30', label: 'SMA 30' },
  { key: 'sma90', label: 'SMA 90' },
  { key: 'bb', label: 'Bollinger' },
]

export default function Controls({
  region, setRegion,
  chartType, setChartType,
  timeRange, setTimeRange,
  granularity, setGranularity,
  activeIndicators, toggleIndicator,
  exportData, currentInstance, isS3,

}) {
  return (
    <div className="controls">
      <div className="control-group">
        <label>Region</label>
        <select value={region} onChange={e => setRegion(e.target.value)}>
          <option value="us-east-1">us-east-1</option>
          <option value="us-west-2">us-west-2</option>
          <option value="eu-west-1">eu-west-1</option>
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
                  onClick={() => { setTimeRange(r.range); setGranularity(r.granularity) }}
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
