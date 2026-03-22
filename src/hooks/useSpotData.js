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

  return { meta, loading, loadRegion, getInstanceData }
}
