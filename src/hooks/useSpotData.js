import { useState, useEffect, useRef } from 'react'

const BASE = import.meta.env.BASE_URL + 'data'

export function useSpotData() {
  const [meta, setMeta] = useState({})
  const [loading, setLoading] = useState(true)
  const cache = useRef({})

  useEffect(() => {
    fetch(`${BASE}/meta.json`).then(r => r.json()).then(setMeta).finally(() => setLoading(false))
  }, [])

  async function loadRegion(region) {
    if (cache.current[`${region}/daily`]) return
    const [d, w, m] = await Promise.all([
      fetch(`${BASE}/${region}/daily.json`).then(r => r.json()),
      fetch(`${BASE}/${region}/weekly.json`).then(r => r.json()),
      fetch(`${BASE}/${region}/monthly.json`).then(r => r.json()),
    ])
    cache.current[`${region}/daily`] = d
    cache.current[`${region}/weekly`] = w
    cache.current[`${region}/monthly`] = m

    // Load on-demand, RI, and S3 data (optional, may not exist)
    try {
      const [od, ri, s3, lambda, rds] = await Promise.all([
        fetch(`${BASE}/${region}/ondemand.json`).then(r => r.ok ? r.json() : []),
        fetch(`${BASE}/${region}/ri.json`).then(r => r.ok ? r.json() : []),
        fetch(`${BASE}/${region}/s3.json`).then(r => r.ok ? r.json() : []),
        fetch(`${BASE}/${region}/lambda.json`).then(r => r.ok ? r.json() : []),
        fetch(`${BASE}/${region}/rds.json`).then(r => r.ok ? r.json() : []),
      ])
      cache.current[`${region}/ondemand`] = od
      cache.current[`${region}/ri`] = ri
      cache.current[`${region}/s3`] = s3
      cache.current[`${region}/lambda`] = lambda
      cache.current[`${region}/rds`] = rds

      const storageComp = await fetch(`${BASE}/${region}/storage_comparison.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
      cache.current[`${region}/storage_comparison`] = storageComp
    } catch {
      cache.current[`${region}/ondemand`] = []
      cache.current[`${region}/ri`] = []
      cache.current[`${region}/s3`] = []
      cache.current[`${region}/lambda`] = []
      cache.current[`${region}/rds`] = []
      cache.current[`${region}/storage_comparison`] = {}
    }
  }

  function getData(region, gran) {
    return cache.current[`${region}/${gran}`] || []
  }

  function getInstanceData(inst, region, granularity) {
    const fallbackOrder = [granularity, 'daily', 'weekly', 'monthly']
    const seen = new Set()
    for (const gran of fallbackOrder) {
      if (seen.has(gran)) continue
      seen.add(gran)
      const data = getData(region, gran)
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

  function getOnDemandData(inst, region) {
    const data = cache.current[`${region}/ondemand`] || []
    const mapped = data
      .filter(d => d.instance_type === inst)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return dedupeByDate(mapped)
  }

  function getRIData(inst, region, riType) {
    const data = cache.current[`${region}/ri`] || []
    const mapped = data
      .filter(d => d.instance_type === inst && d.ri_type === riType)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return dedupeByDate(mapped)
  }

  function getS3Data(region, storageClass) {
    const data = cache.current[`${region}/s3`] || []
    const mapped = data
      .filter(d => d.storage_class === storageClass)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return dedupeByDate(mapped)
  }

  function getS3Classes(region) {
    const data = cache.current[`${region}/s3`] || []
    return [...new Set(data.map(d => d.storage_class))].sort()
  }

  function getLambdaData(region, category) {
    const data = cache.current[`${region}/lambda`] || []
    const mapped = data
      .filter(d => d.category === category)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return dedupeByDate(mapped)
  }

  function getLambdaCategories(region) {
    const data = cache.current[`${region}/lambda`] || []
    return [...new Set(data.map(d => d.category))].sort()
  }

  function getRDSData(region, instanceType, engine) {
    const data = cache.current[`${region}/rds`] || []
    const mapped = data
      .filter(d => d.instance_type === instanceType && d.engine === engine)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ time: d.date, value: d.price }))
    return dedupeByDate(mapped)
  }

  function getRDSInstances(region) {
    const data = cache.current[`${region}/rds`] || []
    const types = [...new Set(data.map(d => d.instance_type))].sort()
    return types.map(t => {
      const latest = data.filter(d => d.instance_type === t && d.engine === 'MySQL')
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      return { t, p: latest ? latest.price : 0 }
    })
  }

  function getStorageComparison(region) {
    return cache.current[`${region}/storage_comparison`] || {}
  }

  return { meta, loading, loadRegion, getInstanceData, getOnDemandData, getRIData, getS3Data, getS3Classes, getLambdaData, getLambdaCategories, getRDSData, getRDSInstances, getStorageComparison }
}
