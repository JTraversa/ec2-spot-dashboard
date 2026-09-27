import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import CorpusBar from '../components/CorpusBar'
import SiteFooter from '../components/SiteFooter'
import { SLOTS, OTHER, CHART_SURFACE, CHART_GRID, CHART_TEXT, CHART_BORDER } from '../charts/palette'

// Free GPU charts: daily median USD per GPU-hour per provider, plus the
// hyperscaler spot legs, from public/data/gpu/{latest,history}.json (written
// daily by cloud-pricing-data/tools/publish-gpu.cjs). Full history, every
// quote, lo/mean/hi and per-region detail live in the paid API.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const ROOT = 'https://cloud.trycorpus.ai'
const API_DOCS = `${ROOT}/docs`
const FEATURED = ['H100 SXM', 'H200', 'B200', 'A100 SXM 80GB', 'L40S', 'L4', 'RTX 4090', 'RTX 5090', 'MI300X', 'GB200']

// Display names for the provider and market slugs in the data. A slug missing
// here falls back to itself, so a new provider still renders.
const PROVIDER_NAMES = {
  'akash': 'Akash',
  'aws-spot': 'AWS spot',
  'azure-spot': 'Azure spot',
  'coreweave': 'CoreWeave',
  'crusoe': 'Crusoe',
  'datacrunch': 'DataCrunch',
  'gcp-spot': 'Google Cloud spot',
  'hyperbolic': 'Hyperbolic',
  'ionet': 'io.net',
  'lambda': 'Lambda',
  'linode': 'Linode',
  'nebius': 'Nebius',
  'nosana': 'Nosana',
  'oci': 'Oracle Cloud',
  'primeintellect': 'Prime Intellect',
  'runpod': 'RunPod',
  'shadeform': 'Shadeform',
  'spheron': 'Spheron',
  'tensordock': 'TensorDock',
  'vast': 'Vast.ai',
  'vultr': 'Vultr',
}
const MARKET_NAMES = {
  ondemand: 'on-demand',
  spot: 'spot',
  bid: 'interruptible bid',
  community: 'community cloud',
  secure: 'secure cloud',
  network: 'network',
  lease: 'active leases',
  executed: 'executed jobs',
  rented: 'rented',
}
const providerName = (slug) => PROVIDER_NAMES[slug] || slug
const marketName = (slug) => MARKET_NAMES[slug] || slug
const legLabel = (prov) => `${providerName(prov)}, cheapest region`
const fmt = (v) => (v == null ? 'n/a' : `$${v.toFixed(2)}`)
const lastValue = (rows) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][1] != null) return rows[i][1]
  return Infinity
}

export default function GpuPage() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState(null)
  const [gpu, setGpu] = useState('H100 SXM')
  const [error, setError] = useState(null)
  const [stress, setStress] = useState(null) // free capacity headline from the API (same host)
  const chartRef = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/data/gpu/latest.json`).then((r) => r.json()),
      fetch(`${BASE}/data/gpu/history.json`).then((r) => r.json()),
      fetch(`${ROOT}/v1/capacity/headline`).then((r) => (r.ok ? r.json() : null)).then((j) => setStress(j)).catch(() => {}),
    ]).then(([l, h]) => { setLatest(l); setHistory(h); if (!l.models[gpu]) setGpu(Object.keys(l.models)[0]) })
      .catch(() => setError('Could not load the price data. Reload the page in a minute.'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const models = useMemo(() => {
    if (!latest) return []
    const all = Object.keys(latest.models)
    const rest = all.filter((m) => !FEATURED.includes(m)).sort()
    return [...FEATURED.filter((m) => all.includes(m)), ...rest]
  }, [latest])

  const rows = useMemo(() => {
    if (!latest || !latest.models[gpu]) return []
    const m = latest.models[gpu]
    const out = Object.entries(m.providers).map(([k, v]) => ({ key: k, name: providerName(k.split('/')[0]), market: marketName(k.split('/')[1]), kind: 'quote', lo: v.lo, median: v.median, n: v.n, day: v.day }))
    // one hyperscaler row per provider: the cheapest region, with the region count
    const byProv = {}
    for (const [k, v] of Object.entries(m.hyperscaler_spot || {})) {
      const [prov, region] = k.split('/')
      const cur = byProv[prov]
      if (!cur || v.price < cur.lo) byProv[prov] = { key: prov, name: providerName(prov), market: region, kind: 'spot', lo: v.price, median: null, n: (cur ? cur.n : 0) + 1, day: v.day, instance: v.instance }
      else cur.n += 1
    }
    return [...out, ...Object.values(byProv)].sort((a, b) => a.lo - b.lo)
  }, [latest, gpu])

  // Plotted series: daily median per provider, plus one hyperscaler leg per
  // provider (the cheapest region each day). Ranked cheapest first by their
  // latest value; the six cheapest take the chart slots in that order and the
  // rest fold into the neutral "other" style, so no color is ever reused.
  const plotted = useMemo(() => {
    if (!history || !history.models[gpu]) return []
    const series = history.models[gpu]
    const keys = Object.keys(series)
    const legs = {}
    for (const k of keys) {
      if (!k.includes('-spot/')) continue
      const prov = k.split('/')[0]
      const m = (legs[prov] = legs[prov] || {})
      for (const [d, p] of series[k]) if (p != null && (m[d] == null || p < m[d])) m[d] = p
    }
    const list = [
      ...keys.filter((k) => !k.includes('-spot/')).map((k) => ({ key: k, name: providerName(k), rows: series[k] })),
      ...Object.entries(legs).map(([prov, m]) => ({ key: prov, name: legLabel(prov), rows: Object.entries(m).sort() })),
    ]
    list.sort((a, b) => lastValue(a.rows) - lastValue(b.rows) || a.name.localeCompare(b.name))
    return list.map((s, i) => ({ ...s, color: i < SLOTS.length ? SLOTS[i] : OTHER, other: i >= SLOTS.length }))
  }, [history, gpu])

  useEffect(() => {
    if (!plotted.length || !chartRef.current) return
    const el = chartRef.current
    el.innerHTML = ''
    const chart = createChart(el, {
      layout: { background: { color: CHART_SURFACE }, textColor: CHART_TEXT, fontFamily: "'Inter', system-ui, sans-serif" },
      grid: { vertLines: { color: CHART_GRID }, horzLines: { color: CHART_GRID } },
      rightPriceScale: { borderColor: CHART_BORDER }, timeScale: { borderColor: CHART_BORDER },
      autoSize: true,
    })
    // "Other" lines first so the six slotted series draw on top of them.
    const order = [...plotted.filter((s) => s.other), ...plotted.filter((s) => !s.other)]
    for (const s of order) {
      const line = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: s.other ? 1 : 2,
        title: s.other ? '' : s.name,
        lastValueVisible: !s.other,
        priceLineVisible: false,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      })
      line.setData(s.rows.filter((r) => r[1] != null).map(([time, value]) => ({ time, value })))
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [plotted])

  const slotted = plotted.filter((s) => !s.other)
  const others = plotted.filter((s) => s.other)
  const stressFor = stress && stress.models ? stress.models.find((m) => m.gpu === gpu) : null

  return (
    <>
      <CorpusBar current="charts" />
      <main className="wrap">
        <h1>GPU rental price charts</h1>
        <p className="lead">USD per GPU-hour across neo-clouds, marketplaces and other clouds, beside AWS, Google Cloud and Azure spot for the same accelerator. Public price feeds, one snapshot a day; hyperscaler spot from our own price-change events (daily average of the mapped instance ÷ GPUs per node).</p>
        {error && <p className="note error">{error}</p>}
        <div className="controls">
          <label htmlFor="gpu">GPU</label>
          <select id="gpu" value={gpu} onChange={(e) => setGpu(e.target.value)}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          {latest && <span className="note">Snapshot {latest.generated_at.slice(0, 10)} · {latest.days}-day window</span>}
          {stressFor && (
            <a className={`stress s${Math.min(3, Math.floor(stressFor.score / 25))}`} href={`${ROOT}/docs#capacity-stress`} title="0 is slack, 100 is tight; every component is in the paid API">
              Capacity stress {stressFor.score}<small>/100 · {stressFor.signals} signals</small>
            </a>
          )}
        </div>
        <div className="grid">
          <div className="panel">
            <h2>Daily median, USD per GPU-hour</h2>
            <div className="chart" ref={chartRef} />
            <div className="note legend">
              {slotted.map((s) => <span key={s.name} className="item"><span className="sw" style={{ background: s.color }} />{s.name}</span>)}
              {others.length > 0 && (
                <span className="item other"><span className="sw thin" style={{ background: OTHER }} />Other: {others.map((s) => s.name).join(', ')}</span>
              )}
            </div>
            {others.length > 0 && <p className="note small">Colored lines are the six cheapest series today; the rest are drawn in gray.</p>}
          </div>
          <div className="panel">
            <h2>Today, cheapest first</h2>
            <div className="tw"><table><thead><tr><th>Provider · market</th><th className="num">Low</th><th className="num">Median</th><th className="num">n</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}><td>{r.name} · <span className="mk">{r.market}</span>{r.kind === 'spot' && <span className="tag">{r.instance} · {r.n} regions</span>}</td><td className="num">{fmt(r.lo)}</td><td className="num">{fmt(r.median)}</td><td className="num">{r.n}</td></tr>
              ))}</tbody></table></div>
            <p className="note">Low and median of each provider's quotes. For hyperscaler spot the low is the cheapest region; per-region detail, every marketplace offer (host reliability, bids), lo/mean/hi and the full history are in the API.</p>
          </div>
        </div>
        <div className="cta">
          <span>Every quote, every region and the full history are in the API: <b>/gpu/quotes</b> from 0.01 USDC per call, <b>/gpu/index</b> 0.05, <b>/gpu/snapshot</b> 0.10. No account needed: pay per call over x402 or MPP, or use a prepaid key.</span>
          <a href={API_DOCS}>Read the API docs</a>
        </div>
        <p className="note sources">Sources: the public price feeds and APIs of every provider in the table, and each hyperscaler's own spot price history. Methodology: <a href={`${ROOT}/methodology`}>how quotes are collected and normalized</a>.</p>
      </main>
      <SiteFooter />
    </>
  )
}
