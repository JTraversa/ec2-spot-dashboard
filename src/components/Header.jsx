const PROVIDER_META = {
  aws:   { title: 'AWS Pricing Dashboard',   subtitle: 'Historical EC2 spot pricing — Linux/UNIX, 2014 to present' },
  gcp:   { title: 'GCP Pricing Dashboard',   subtitle: 'Historical Spot VM pricing — 2024 to present' },
  azure: { title: 'Azure Pricing Dashboard', subtitle: 'Historical Spot VM pricing — 2025 to present' },
}

export default function Header({ provider = 'aws', stats }) {
  const { title, subtitle } = PROVIDER_META[provider] || PROVIDER_META.aws
  return (
    <div className="dashboard-header">
      <div>
        <h1>{title}</h1>
        <div className="subtitle">{subtitle}</div>
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
