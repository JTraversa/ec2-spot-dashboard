import { useState, useEffect, useRef } from 'react'

const BASE = import.meta.env.BASE_URL + 'data'
const today = () => new Date().toISOString().slice(0, 10)

export function useSpotData() {
  const [meta, setMeta] = useState({ aws: {}, gcp: {}, azure: {} })
  const [loading, setLoading] = useState(true)
  const cache = useRef({})

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/aws/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${BASE}/gcp/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${BASE}/azure/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([aws, gcp, azure]) => setMeta({ aws, gcp, azure }))
      .finally(() => setLoading(false))
  }, [])

  // Per-region data: the on-demand series + (AWS only) list-price overlays.
  // The spot price series itself is NOT loaded here — it's per instance.
  async function loadRegion(provider, region) {
    const key = `${provider}/${region}/_region`
    if (cache.current[key]) return
    const base = `${BASE}/${provider}/${region}`
    const ondemand = await fetch(`${base}/ondemand.json`).then(r => r.ok ? r.json() : []).catch(() => [])
    cache.current[`${provider}/${region}/ondemand`] = ondemand
    if (provider === 'aws') {
      const names = ['ri', 's3', 'lambda', 'rds', 'ebs', 'transfer']
      const results = await Promise.all(names.map(n =>
        fetch(`${base}/${n}.json`).then(r => r.ok ? r.json() : []).catch(() => [])))
      names.forEach((n, i) => { cache.current[`${provider}/${region}/${n}`] = results[i] })
      const sc = await fetch(`${base}/storage_comparison.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
      cache.current[`${provider}/${region}/storage_comparison`] = sc
    }
    cache.current[key] = true
  }

  // Spot history for one instance: { daily, weekly, monthly } — full range each.
  async function loadInstance(provider, region, inst) {
    const key = `${provider}/${region}/inst/${inst}`
    if (cache.current[key]) return
    const empty = { daily: [], weekly: [], monthly: [] }
    const data = await fetch(`${BASE}/${provider}/${region}/inst/${encodeURIComponent(inst)}.json`)
      .then(r => r.ok ? r.json() : empty).catch(() => empty)
    cache.current[key] = data
  }

  function instanceData(provider, region, inst) {
    return cache.current[`${provider}/${region}/inst/${inst}`] || null
  }

  function instanceLatestDate(provider, region, inst) {
    const d = instanceData(provider, region, inst)
    return d && d.daily.length ? d.daily[d.daily.length - 1].date : ''
  }

  // Full series for the requested granularity, falling back to a coarser one if
  // the instance has no rows at that resolution.
  function getInstanceData(inst, provider, region, granularity) {
    const d = instanceData(provider, region, inst)
    if (!d) return { data: [], actualGranularity: granularity }
    for (const g of [granularity, 'daily', 'weekly', 'monthly']) {
      if (d[g] && d[g].length) return { data: d[g], actualGranularity: g }
    }
    return { data: [], actualGranularity: granularity }
  }

  function dedupeByDate(arr) {
    const seen = new Set()
    return arr.filter(d => {
      if (seen.has(d.time)) return false
      seen.add(d.time)
      return true
    })
  }

  // Overlay files are sparse change-point series ending at the last price change.
  // Carry the last value forward to `latestDate` so the line spans the chart.
  function anchorToLatest(series, latestDate) {
    if (series.length === 0 || !latestDate) return series
    const last = series[series.length - 1]
    if (latestDate > last.time) return [...series, { time: latestDate, value: last.value }]
    return series
  }

  function getOnDemandData(inst, provider, region) {
    const data = cache.current[`${provider}/${region}/ondemand`] || []
    const mapped = data
      .filter(d => d.instance_type === inst)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), instanceLatestDate(provider, region, inst))
  }

  function getRIData(inst, provider, region, riType) {
    const data = cache.current[`${provider}/${region}/ri`] || []
    const mapped = data
      .filter(d => d.instance_type === inst && d.ri_type === riType)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), instanceLatestDate(provider, region, inst))
  }

  function getS3Data(provider, region, storageClass) {
    const data = cache.current[`${provider}/${region}/s3`] || []
    const mapped = data
      .filter(d => d.storage_class === storageClass)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), today())
  }

  function getS3Classes(provider, region) {
    const data = cache.current[`${provider}/${region}/s3`] || []
    return [...new Set(data.map(d => d.storage_class))].sort()
  }

  function getLambdaData(provider, region, category) {
    const data = cache.current[`${provider}/${region}/lambda`] || []
    const mapped = data
      .filter(d => d.category === category)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), today())
  }

  function getLambdaCategories(provider, region) {
    const data = cache.current[`${provider}/${region}/lambda`] || []
    return [...new Set(data.map(d => d.category))].sort()
  }

  function getRDSData(provider, region, instanceType, engine) {
    const data = cache.current[`${provider}/${region}/rds`] || []
    const mapped = data
      .filter(d => d.instance_type === instanceType && d.engine === engine)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), today())
  }

  function getRDSInstances(provider, region) {
    const data = cache.current[`${provider}/${region}/rds`] || []
    const types = [...new Set(data.map(d => d.instance_type))].sort()
    return types.map(t => {
      const latest = data.filter(d => d.instance_type === t && d.engine === 'MySQL')
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      return { t, p: latest ? latest.price : 0 }
    })
  }

  function getStorageComparison(provider, region) {
    return cache.current[`${provider}/${region}/storage_comparison`] || {}
  }

  function getEBSData(provider, region, volumeType) {
    const data = cache.current[`${provider}/${region}/ebs`] || []
    const mapped = data
      .filter(d => d.volume_type === volumeType)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), today())
  }

  function getEBSTypes(provider, region) {
    const data = cache.current[`${provider}/${region}/ebs`] || []
    const order = ['gp3', 'gp2', 'io2', 'io1', 'st1', 'sc1']
    const found = [...new Set(data.map(d => d.volume_type))]
    return order.filter(t => found.includes(t))
  }

  function getTransferData(provider, region, transferType) {
    const data = cache.current[`${provider}/${region}/transfer`] || []
    const mapped = data
      .filter(d => d.transfer_type === transferType)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), today())
  }

  function getTransferTypes(provider, region) {
    const data = cache.current[`${provider}/${region}/transfer`] || []
    const order = ['Internet (0-10 TB)', 'Internet (10-50 TB)', 'Internet (50-150 TB)', 'Cross-Region', 'Cross-AZ']
    const found = [...new Set(data.map(d => d.transfer_type))]
    return order.filter(t => found.includes(t))
  }

  // Sidebar list comes straight from meta (instance type + latest spot price).
  function getAllRegionInstances(provider, region) {
    return (meta[provider] && meta[provider][region]) || []
  }

  return {
    meta, loading, loadRegion, loadInstance, getAllRegionInstances,
    getInstanceData, getOnDemandData, getRIData,
    getS3Data, getS3Classes,
    getLambdaData, getLambdaCategories,
    getRDSData, getRDSInstances,
    getStorageComparison,
    getEBSData, getEBSTypes,
    getTransferData, getTransferTypes,
  }
}
