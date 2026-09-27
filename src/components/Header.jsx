import BrandStrip from './BrandStrip'

const PROVIDER_META = {
  aws:   { subtitle: 'AWS EC2 spot prices for Linux/UNIX, 2014 to today' },
  gcp:   { subtitle: 'Google Cloud Spot VM prices, 2024 to today' },
  azure: { subtitle: 'Azure Spot VM prices, 2025 to today' },
}

export default function Header({ provider = 'aws', stats }) {
  const { subtitle } = PROVIDER_META[provider] || PROVIDER_META.aws
  return (
    <div className="dashboard-header">
      <div>
        <h1>Cloud pricing charts</h1>
        <div className="subtitle">{subtitle}</div>
        <BrandStrip />
      </div>
      <div className="header-stats">
        <div className="stat-box">
          <div className="label">Current price</div>
          <div className={`value ${stats.changeClass || 'neutral'}`}>{stats.price || 'n/a'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Period change</div>
          <div className={`value ${stats.changeClass || 'neutral'}`}>{stats.change || 'n/a'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Price range</div>
          <div className="value neutral">{stats.range || 'n/a'}</div>
        </div>
        <div className="stat-box">
          <div className="label">Data</div>
          <div className="value neutral">{stats.granularity || 'n/a'}</div>
        </div>
      </div>
    </div>
  )
}
