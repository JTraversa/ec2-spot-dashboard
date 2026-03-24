const EC2_CATEGORIES = {
  'General Purpose': /^(m[1-7]|t[1-4])\./,
  'Compute Optimized': /^c[1-7]\./,
  'Memory Optimized': /^(r[3-7]|m2\.)/,
  'GPU / Accelerated': /^(g[2-5]|p[2-4])\./,
  'Storage Optimized': /^i[2-4]\./,
}

export default function Sidebar({ instances, s3Items = [], lambdaItems = [], rdsItems = [], currentInstance, onSelect }) {
  const grouped = {}
  for (const [cat, regex] of Object.entries(EC2_CATEGORIES)) {
    const items = instances.filter(i => regex.test(i.t))
    if (items.length > 0) grouped[cat] = items
  }

  return (
    <div className="sidebar">
      {Object.entries(grouped).map(([cat, items]) => (
        <div className="sidebar-section" key={cat}>
          <h3>{cat}</h3>
          {items.map(item => (
            <div
              key={item.t}
              className={`instance-item ${item.t === currentInstance ? 'selected' : ''}`}
              onClick={() => onSelect(item.t)}
            >
              <span>{item.t}</span>
              <span className="price">${item.p.toFixed(4)}</span>
            </div>
          ))}
        </div>
      ))}

      {rdsItems.length > 0 && (
        <div className="sidebar-section">
          <h3>Database (RDS)</h3>
          {rdsItems.map(item => (
            <div
              key={item.t}
              className={`instance-item ${('rds:' + item.t) === currentInstance ? 'selected' : ''}`}
              onClick={() => onSelect('rds:' + item.t)}
            >
              <span>{item.t}</span>
              <span className="price">${item.p.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      {s3Items.length > 0 && (
        <div className="sidebar-section">
          <h3>Storage</h3>
          <div
            className={`instance-item ${currentInstance === 's3:all' ? 'selected' : ''}`}
            onClick={() => onSelect('s3:all')}
          >
            <span>S3 (all classes)</span>
          </div>
        </div>
      )}

      {lambdaItems.length > 0 && (
        <div className="sidebar-section">
          <h3>Serverless</h3>
          <div
            className={`instance-item ${currentInstance === 'lambda:all' ? 'selected' : ''}`}
            onClick={() => onSelect('lambda:all')}
          >
            <span>Lambda (all tiers)</span>
          </div>
        </div>
      )}
    </div>
  )
}
