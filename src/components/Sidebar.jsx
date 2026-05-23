const EC2_CATEGORIES = {
  'General Purpose': /^(m[1-7]|t[1-4])\./,
  'Compute Optimized': /^c[1-7]\./,
  'Memory Optimized': /^(r[3-7]|m2\.)/,
  'GPU / Accelerated': /^(g[2-5]|p[2-4])\./,
  'Storage Optimized': /^i[2-4]\./,
}

const GCP_CATEGORIES = {
  'General Purpose': /^(n[0-9]|e2|t2[ad]|f1|g1)-/,
  'Compute Optimized': /^(c[0-9]|h[0-9])-/,
  'Memory Optimized': /^m[0-9]-/,
  'GPU / Accelerated': /^(a[0-9]|g2)-/,
  'Storage Optimized': /^z[0-9]-/,
}

const AZURE_CATEGORIES = {
  'General Purpose': /^D/,
  'Compute Optimized': /^F/,
  'Memory Optimized': /^E/,
  'Storage Optimized': /^L/,
  'GPU / Accelerated': /^N/,
}

function groupInstances(instances, categories) {
  const grouped = {}
  const uncategorized = []
  for (const [cat, regex] of Object.entries(categories)) {
    const items = instances.filter(i => regex.test(i.t))
    if (items.length > 0) grouped[cat] = items
  }
  const categorized = new Set(Object.values(grouped).flat().map(i => i.t))
  for (const i of instances) {
    if (!categorized.has(i.t)) uncategorized.push(i)
  }
  if (uncategorized.length > 0) grouped['Other'] = uncategorized
  return grouped
}

import { useState, useMemo } from 'react'

export default function Sidebar({ provider = 'aws', instances, allInstances = [], s3Items = [], lambdaItems = [], rdsItems = [], hasEBS = false, hasTransfer = false, currentInstance, onSelect }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const categories = provider === 'gcp' ? GCP_CATEGORIES : provider === 'azure' ? AZURE_CATEGORIES : EC2_CATEGORIES
  const isAWS = provider === 'aws'

  const hasExpandable = allInstances.length > instances.length

  const activeInstances = expanded && hasExpandable ? allInstances : instances

  const filtered = useMemo(() => {
    if (!search) return activeInstances
    const q = search.toLowerCase()
    return activeInstances.filter(i => i.t.toLowerCase().includes(q))
  }, [activeInstances, search])

  const grouped = useMemo(() => groupInstances(filtered, categories), [filtered, categories])

  return (
    <div className="sidebar">
      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Filter instances..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
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
              <span className="price">${item.p != null ? item.p.toFixed(4) : '—'}</span>
            </div>
          ))}
        </div>
      ))}

      {isAWS && rdsItems.length > 0 && (
        <div className="sidebar-section">
          <h3>Database (RDS)</h3>
          {rdsItems.map(item => (
            <div
              key={item.t}
              className={`instance-item ${('rds:' + item.t) === currentInstance ? 'selected' : ''}`}
              onClick={() => onSelect('rds:' + item.t)}
            >
              <span>{item.t}</span>
              <span className="price">${item.p != null ? item.p.toFixed(4) : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {isAWS && (s3Items.length > 0 || hasEBS) && (
        <div className="sidebar-section">
          <h3>Storage</h3>
          {s3Items.length > 0 && (
            <div
              className={`instance-item ${currentInstance === 's3:all' ? 'selected' : ''}`}
              onClick={() => onSelect('s3:all')}
            >
              <span>S3 Object Storage</span>
            </div>
          )}
          {hasEBS && (
            <div
              className={`instance-item ${currentInstance === 'ebs:all' ? 'selected' : ''}`}
              onClick={() => onSelect('ebs:all')}
            >
              <span>EBS Block Storage</span>
            </div>
          )}
        </div>
      )}

      {isAWS && lambdaItems.length > 0 && (
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

      {isAWS && hasTransfer && (
        <div className="sidebar-section">
          <h3>Networking</h3>
          <div
            className={`instance-item ${currentInstance === 'transfer:all' ? 'selected' : ''}`}
            onClick={() => onSelect('transfer:all')}
          >
            <span>Data Transfer</span>
          </div>
        </div>
      )}

      {hasExpandable && (
        <div className="sidebar-expand">
          <button onClick={() => setExpanded(e => !e)}>
            {expanded
              ? `Show curated (${instances.length})`
              : `Expand dataset (${allInstances.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
