import { useState, useEffect, useRef } from 'react'

const BASE = import.meta.env.BASE_URL + 'data'

export function useSpotData() {
  const [meta, setMeta] = useState({ aws: {}, gcp: {}, azure: {} })
  const [loading, setLoading] = useState(true)
  const cache = useRef({})

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/aws/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${BASE}/gcp/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${BASE}/azure/meta.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([aws, gcp, azure]) => {
      setMeta({ aws, gcp, azure })
    }).finally(() => setLoading(false))
  }, [])

  async function loadRegion(provider, region) {
    const key = `${provider}/${region}/daily`
    if (cache.current[key]) return

    const base = `${BASE}/${provider}/${region}`
    const [d, w, m] = await Promise.all([
      fetch(`${base}/daily.json`).then(r => r.json()),
      fetch(`${base}/weekly.json`).then(r => r.json()),
      fetch(`${base}/monthly.json`).then(r => r.json()),
    ])
    cache.current[`${provider}/${region}/daily`] = d
    cache.current[`${provider}/${region}/weekly`] = w
    cache.current[`${provider}/${region}/monthly`] = m

    // AWS-only supplemental data
    if (provider === 'aws') {
      try {
        const [od, ri, s3, lambda, rds, ebs, transfer] = await Promise.all([
          fetch(`${base}/ondemand.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/ri.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/s3.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/lambda.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/rds.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/ebs.json`).then(r => r.ok ? r.json() : []),
          fetch(`${base}/transfer.json`).then(r => r.ok ? r.json() : []),
        ])
        cache.current[`${provider}/${region}/ondemand`] = od
        cache.current[`${provider}/${region}/ri`] = ri
        cache.current[`${provider}/${region}/s3`] = s3
        cache.current[`${provider}/${region}/lambda`] = lambda
        cache.current[`${provider}/${region}/rds`] = rds
        cache.current[`${provider}/${region}/ebs`] = ebs
        cache.current[`${provider}/${region}/transfer`] = transfer

        const storageComp = await fetch(`${base}/storage_comparison.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
        cache.current[`${provider}/${region}/storage_comparison`] = storageComp
      } catch {
        for (const t of ['ondemand', 'ri', 's3', 'lambda', 'rds', 'ebs', 'transfer', 'storage_comparison']) {
          cache.current[`${provider}/${region}/${t}`] = t === 'storage_comparison' ? {} : []
        }
      }
    }
  }

  function getData(provider, region, gran) {
    return cache.current[`${provider}/${region}/${gran}`] || []
  }

  function getInstanceData(inst, provider, region, granularity) {
    const fallbackOrder = [granularity, 'daily', 'weekly', 'monthly']
    const seen = new Set()
    for (const gran of fallbackOrder) {
      if (seen.has(gran)) continue
      seen.add(gran)
      const data = getData(provider, region, gran)
      const instData = data
        .filter(d => d.instance_type === inst)
        .sort((a, b) => a.date.localeCompare(b.date))
      if (instData.length > 0) return { data: instData, actualGranularity: gran }
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

  // Overlay files (RI/S3/Lambda/RDS/EBS/transfer) are sparse change-point series
  // that end at the last price change — often well before "now". Carry the last
  // known value forward to the latest spot date so the line spans the chart
  // instead of stopping mid-range. (daily.json is date-sorted, so the last row
  // is the latest date.)
  function anchorToLatest(series, provider, region) {
    if (series.length === 0) return series
    const daily = cache.current[`${provider}/${region}/daily`] || []
    const latest = daily.length ? daily[daily.length - 1].date : ''
    const last = series[series.length - 1]
    if (latest && latest > last.time) return [...series, { time: latest, value: last.value }]
    return series
  }

  function getOnDemandData(inst, provider, region) {
    const data = cache.current[`${provider}/${region}/ondemand`] || []
    const mapped = data
      .filter(d => d.instance_type === inst)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), provider, region)
  }

  function getRIData(inst, provider, region, riType) {
    const data = cache.current[`${provider}/${region}/ri`] || []
    const mapped = data
      .filter(d => d.instance_type === inst && d.ri_type === riType)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), provider, region)
  }

  function getS3Data(provider, region, storageClass) {
    const data = cache.current[`${provider}/${region}/s3`] || []
    const mapped = data
      .filter(d => d.storage_class === storageClass)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return anchorToLatest(dedupeByDate(mapped), provider, region)
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
    return anchorToLatest(dedupeByDate(mapped), provider, region)
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
    return anchorToLatest(dedupeByDate(mapped), provider, region)
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
    return anchorToLatest(dedupeByDate(mapped), provider, region)
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
    return anchorToLatest(dedupeByDate(mapped), provider, region)
  }

  function getTransferTypes(provider, region) {
    const data = cache.current[`${provider}/${region}/transfer`] || []
    const order = ['Internet (0-10 TB)', 'Internet (10-50 TB)', 'Internet (50-150 TB)', 'Cross-Region', 'Cross-AZ']
    const found = [...new Set(data.map(d => d.transfer_type))]
    return order.filter(t => found.includes(t))
  }

  function getAllRegionInstances(provider, region) {
    const daily = cache.current[`${provider}/${region}/daily`] || []
    if (daily.length === 0) return []
    const latest = new Map()
    for (const r of daily) {
      const cur = latest.get(r.instance_type)
      if (!cur || r.date > cur.date) latest.set(r.instance_type, r)
    }
    return [...latest.entries()]
      .map(([t, r]) => ({ t, p: r.avg }))
      .sort((a, b) => a.t.localeCompare(b.t))
  }

  return {
    meta, loading, loadRegion, getAllRegionInstances,
    getInstanceData, getOnDemandData, getRIData,
    getS3Data, getS3Classes,
    getLambdaData, getLambdaCategories,
    getRDSData, getRDSInstances,
    getStorageComparison,
    getEBSData, getEBSTypes,
    getTransferData, getTransferTypes,
  }
}
