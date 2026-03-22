const CATEGORIES = {
  'General Purpose': /^(m[1-7]|t[1-4])\./,
  'Compute Optimized': /^c[1-7]\./,
  'Memory Optimized': /^(r[3-7]|m2\.)/,
  'GPU / Accelerated': /^(g[2-5]|p[2-4])\./,
  'Storage Optimized': /^i[2-4]\./,
}

export default function Sidebar({ instances, currentInstance, onSelect }) {
  const grouped = {}
  for (const [cat, regex] of Object.entries(CATEGORIES)) {
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
    </div>
  )
}
