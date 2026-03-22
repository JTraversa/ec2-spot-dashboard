import { useState, useEffect, useCallback, useMemo } from 'react'
import SiteHeader from './components/SiteHeader'
import Socialicons from './components/Socialicons'
import Header from './components/Header'
import Controls from './components/Controls'
import Sidebar from './components/Sidebar'
import Chart from './components/Chart'
import Footer from './components/Footer'
import { useSpotData } from './hooks/useSpotData'

const GRANULARITY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

function App() {
  const { meta, loading, loadRegion, getInstanceData } = useSpotData()

  const [region, setRegion] = useState('us-east-1')
  const [instance, setInstance] = useState(null)
  const [chartType, setChartType] = useState('line')
  const [timeRange, setTimeRange] = useState(90)
  const [granularity, setGranularity] = useState('daily')
  const [activeIndicators, setActiveIndicators] = useState(new Set())
  const [regionLoaded, setRegionLoaded] = useState(false)

  useEffect(() => {
    if (!loading) {
      loadRegion(region).then(() => setRegionLoaded(true))
    }
  }, [loading, region])

  useEffect(() => {
    if (regionLoaded && meta[region] && !instance) {
      const instances = meta[region]
      if (instances.length > 0) setInstance(instances[0].t)
    }
  }, [regionLoaded, meta, region])

  const handleRegionChange = useCallback(async (newRegion) => {
    setRegion(newRegion)
    setInstance(null)
    setRegionLoaded(false)
    await loadRegion(newRegion)
    setRegionLoaded(true)
  }, [loadRegion])

  const toggleIndicator = useCallback((key) => {
    setActiveIndicators(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const { chartData, stats, usedGranularity } = useMemo(() => {
    if (!instance || !regionLoaded) return { chartData: [], stats: {}, usedGranularity: granularity }

    const result = getInstanceData(instance, region, granularity)
    let data = result.data

    if (data.length === 0) return { chartData: [], stats: {}, usedGranularity: result.actualGranularity }

    if (timeRange !== 'all') {
      const latestDate = new Date(data[data.length - 1].date)
      const cutoff = new Date(latestDate)
      cutoff.setDate(cutoff.getDate() - timeRange)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      data = data.filter(d => d.date >= cutoffStr)
    }

    if (data.length === 0) return { chartData: [], stats: {}, usedGranularity: result.actualGranularity }

    const latest = data[data.length - 1]
    const first = data[0]
    const change = ((latest.avg - first.avg) / first.avg * 100)
    const changeClass = change >= 0 ? 'up' : 'down'
    const icon = change >= 0 ? '\u25B2' : '\u25BC'
    const allAvgs = data.map(d => d.avg)

    return {
      chartData: data,
      usedGranularity: result.actualGranularity,
      stats: {
        price: `$${latest.avg.toFixed(4)}`,
        change: `${icon} ${Math.abs(change).toFixed(2)}%`,
        changeClass,
        range: `$${Math.min(...allAvgs).toFixed(4)} — $${Math.max(...allAvgs).toFixed(4)}`,
        granularity: `${GRANULARITY_LABELS[result.actualGranularity]} (${data.length} pts)`,
      },
    }
  }, [instance, region, granularity, timeRange, regionLoaded, getInstanceData])

  const getExportData = useCallback(() => {
    return chartData.map(d => ({
      date: d.date, instance_type: d.instance_type, region,
      open: d.open, high: d.high, low: d.low, close: d.close, avg: d.avg,
    }))
  }, [chartData, region])

  const instances = meta[region] || []

  return (
    <div className="app">
      <SiteHeader />
      <Socialicons />
      <Header stats={stats} />
      <Controls
        region={region} setRegion={handleRegionChange}
        chartType={chartType} setChartType={setChartType}
        timeRange={timeRange} setTimeRange={setTimeRange}
        granularity={granularity} setGranularity={setGranularity}
        activeIndicators={activeIndicators} toggleIndicator={toggleIndicator}
        exportData={getExportData} currentInstance={instance}
      />
      <div className="main">
        <Sidebar instances={instances} currentInstance={instance} onSelect={setInstance} />
        <Chart
          data={chartData}
          chartType={chartType}
          activeIndicators={activeIndicators}
          granularity={usedGranularity}
          instance={instance}
          region={region}
        />
      </div>
      <Footer />
    </div>
  )
}

export default App
