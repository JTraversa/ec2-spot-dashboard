export default function Header({ stats }) {
  return (
    <div className="dashboard-header">
      <div>
        <h1>AWS Pricing Dashboard</h1>
        <div className="subtitle">Historical EC2 and S3 pricing — 2006 to present</div>
      </div>
      <div className="header-stats">
        <div className="stat-box">
          <div className="label">Current Price</div>
          <div className={`value ${stats.changeClass || 'neutral'}`}>{stats.price || '—'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Period Change</div>
          <div className={`value ${stats.changeClass || 'neutral'}`}>{stats.change || '—'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Price Range</div>
          <div className="value neutral">{stats.range || '—'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Data</div>
          <div className="value neutral">{stats.granularity || '—'}</div>
        </div>
      </div>
    </div>
  )
}
