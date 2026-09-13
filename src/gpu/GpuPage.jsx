import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'

// Free GPU headline: daily median USD per GPU-hour per provider, plus the
// hyperscaler spot legs, from public/data/gpu/{latest,history}.json (written
// daily by cloud-pricing-data/tools/publish-gpu.cjs). Full history, every
// quote, lo/mean/hi and per-region detail live in the paid API.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_DOCS = 'https://cloud.trycorpus.ai/docs'
const PALETTE = ['#1F4B8E', '#1cc744', '#ff5126', '#8a2be2', '#e0a800', '#0aa', '#c2185b', '#555', '#795548', '#3f51b5', '#009688', '#9e9d24']
const FEATURED = ['H100 SXM', 'H200', 'B200', 'A100 SXM 80GB', 'L40S', 'L4', 'RTX 4090', 'RTX 5090', 'MI300X', 'GB200']
const label = (k) => k.replace('-spot/', ' spot · ').replace('/', ' · ')
const fmt = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)

export default function GpuPage() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState(null)
  const [gpu, setGpu] = useState('H100 SXM')
  const [error, setError] = useState(null)
  const chartRef = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/data/gpu/latest.json`).then((r) => r.json()),
      fetch(`${BASE}/data/gpu/history.json`).then((r) => r.json()),
    ]).then(([l, h]) => { setLatest(l); setHistory(h); if (!l.models[gpu]) setGpu(Object.keys(l.models)[0]) })
      .catch((e) => setError(String(e)))
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
    const out = Object.entries(m.providers).map(([k, v]) => ({ key: k, kind: 'quote', lo: v.lo, median: v.median, n: v.n, day: v.day }))
    // one hyperscaler row per provider: the cheapest region, with the region count
    const byProv = {}
    for (const [k, v] of Object.entries(m.hyperscaler_spot || {})) {
      const prov = k.split('/')[0]
      const cur = byProv[prov]
      if (!cur || v.price < cur.lo) byProv[prov] = { key: `${prov} (${k.split('/')[1]})`, kind: 'spot', lo: v.price, median: null, n: (cur ? cur.n : 0) + 1, day: v.day, instance: v.instance }
      else cur.n += 1
    }
    return [...out, ...Object.values(byProv)].sort((a, b) => a.lo - b.lo)
  }, [latest, gpu])

  // chart: daily median per provider + hyperscaler legs (cheapest region per provider)
  useEffect(() => {
    if (!history || !history.models[gpu] || !chartRef.current) return
    const el = chartRef.current
    el.innerHTML = ''
    const chart = createChart(el, {
      layout: { background: { color: '#ffffff' }, textColor: '#555', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      rightPriceScale: { borderColor: '#d4d4d4' }, timeScale: { borderColor: '#d4d4d4' },
      autoSize: true,
    })
    const series = history.models[gpu]
    const keys = Object.keys(series)
    // collapse hyperscaler legs to the cheapest region per provider per day
    const legs = {}
    for (const k of keys) {
      if (!k.includes('-spot/')) continue
      const prov = k.split('/')[0]
      const m = (legs[prov] = legs[prov] || {})
      for (const [d, p] of series[k]) if (m[d] == null || p < m[d]) m[d] = p
    }
    const plotted = [
      ...keys.filter((k) => !k.includes('-spot/')).map((k) => [k, series[k]]),
      ...Object.entries(legs).map(([prov, m]) => [`${prov} (cheapest region)`, Object.entries(m).sort()]),
    ]
    plotted.forEach(([name, rows], i) => {
      const s = chart.addSeries(LineSeries, { color: PALETTE[i % PALETTE.length], lineWidth: 2, title: name, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
      s.setData(rows.filter((r) => r[1] != null).map(([time, value]) => ({ time, value })))
    })
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [history, gpu])

  const legend = useMemo(() => {
    if (!history || !history.models[gpu]) return []
    const keys = Object.keys(history.models[gpu])
    const provs = [...new Set(keys.filter((k) => k.includes('-spot/')).map((k) => k.split('/')[0]))]
    return [...keys.filter((k) => !k.includes('-spot/')), ...provs.map((p) => `${p} (cheapest region)`)]
  }, [history, gpu])

  return (
    <>
      <div className="top"><div className="top-in">
        <a className="brand" href="https://www.trycorpus.ai"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.75" /><rect className="core" x="8" y="8" width="8" height="8" /></svg>corpusAI <em>/ GPU rental prices</em></a>
        <div className="top-links"><a href={`${BASE}/`}>cloud pricing dashboard</a><a href={API_DOCS}>API docs</a><a href="https://cloud.trycorpus.ai/openapi.json">openapi.json</a><a href="https://www.trycorpus.ai">trycorpus.ai</a></div>
      </div></div>
      <div className="wrap">
        <h1>GPU rental prices</h1>
        <p className="lead">USD per GPU-hour across neo-clouds, marketplaces and other clouds, beside AWS and GCP spot for the same accelerator. Public price feeds, one snapshot a day; hyperscaler spot from our own price-change events (daily average of the mapped instance ÷ GPUs per node).</p>
        {error && <p className="note">Could not load data: {error}</p>}
        <div className="controls">
          <label htmlFor="gpu">GPU</label>
          <select id="gpu" value={gpu} onChange={(e) => setGpu(e.target.value)}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          {latest && <span className="note">snapshot {latest.generated_at.slice(0, 10)} · {latest.days}-day window</span>}
        </div>
        <div className="grid">
          <div className="panel">
            <h2>Daily median, USD per GPU-hour</h2>
            <div className="chart" ref={chartRef} />
            <div className="note legend">{legend.map((name, i) => <span key={name} className="item"><span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />{name}</span>)}</div>
          </div>
          <div className="panel">
            <h2>Today, cheapest first</h2>
            <div className="tw"><table><thead><tr><th>Provider · market</th><th className="num">Low</th><th className="num">Median</th><th className="num">n</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}><td>{label(r.key)}{r.kind === 'spot' && <span className="tag">{r.instance} · {r.n} regions</span>}</td><td className="num">{fmt(r.lo)}</td><td className="num">{fmt(r.median)}</td><td className="num">{r.n}</td></tr>
              ))}</tbody></table></div>
            <p className="note">Low and median of each provider's quotes. For hyperscaler spot the low is the cheapest region; per-region detail, every marketplace offer (host reliability, bids), lo/mean/hi and the full history are in the API.</p>
          </div>
        </div>
        <div className="cta"><span>Need every quote, every region and the full history? <b>/gpu/quotes</b> from 0.01 USDC, <b>/gpu/index</b> 0.05, <b>/gpu/snapshot</b> 0.10, paid per call over x402.</span><a href={API_DOCS}>Read the API docs →</a></div>
      </div>
      <footer><span>© {new Date().getUTCFullYear()} corpusAI · Software that outlives its owners.</span><span>Sources: RunPod, Vast.ai, DataCrunch, Lambda, Vultr, Linode, Oracle Cloud public price feeds; AWS EC2 DescribeSpotPriceHistory; GCP Capacity Advisor.</span></footer>
    </>
  )
}
