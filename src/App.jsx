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
  const { meta, loading, loadRegion, getInstanceData, getOnDemandData, getRIData, getS3Data, getS3Classes } = useSpotData()

  const [region, setRegion] = useState('us-east-1')
  const [instance, setInstance] = useState(null)
  const [chartType, setChartType] = useState('line')
  const [timeRange, setTimeRange] = useState(90)
  const [granularity, setGranularity] = useState('daily')
  const [activeIndicators, setActiveIndicators] = useState(new Set())
  const [regionLoaded, setRegionLoaded] = useState(false)

  // Track whether the selected item is S3
  const isS3 = instance === 's3:all'

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

  // S3 chart data — all classes as a map
  const s3ChartData = useMemo(() => {
    if (!isS3 || !regionLoaded) return {}
    const classes = getS3Classes(region)
    const result = {}
    for (const cls of classes) {
      const data = getS3Data(region, cls)
      if (data.length > 0) result[cls] = data
    }
    return result
  }, [isS3, region, regionLoaded])

  // EC2 chart data
  const { chartData, stats, usedGranularity } = useMemo(() => {
    if (isS3) {
      const stdData = s3ChartData['Standard'] || []
      if (stdData.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = stdData[stdData.length - 1]
      const first = stdData[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '\u25B2' : '\u25BC'
      const allVals = stdData.map(d => d.value)
      const totalClasses = Object.keys(s3ChartData).length
      return {
        chartData: [],
        usedGranularity: 'monthly',
        stats: {
          price: `$${latest.value.toFixed(4)}/GB`,
          change: `${icon} ${Math.abs(change).toFixed(1)}%`,
          changeClass,
          range: `$${Math.min(...allVals).toFixed(4)} — $${Math.max(...allVals).toFixed(4)}`,
          granularity: `${totalClasses} storage classes`,
        },
      }
    }

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
  }, [isS3, s3ChartData, instance, region, granularity, timeRange, regionLoaded, getInstanceData])

  const getExportData = useCallback(() => {
    return chartData.map(d => ({
      date: d.date, instance_type: d.instance_type, region,
      open: d.open, high: d.high, low: d.low, close: d.close, avg: d.avg,
    }))
  }, [chartData, region])

  const onDemandData = useMemo(() => {
    if (isS3 || !instance || !regionLoaded) return []
    return getOnDemandData(instance, region)
  }, [isS3, instance, region, regionLoaded])

  const riDataMemo = useMemo(() => {
    if (isS3 || !instance || !regionLoaded) return null
    return {
      ri1yNoUpfront: getRIData(instance, region, 'ri_1y_no_upfront_standard'),
      ri3yNoUpfront: getRIData(instance, region, 'ri_3y_no_upfront_standard'),
    }
  }, [isS3, instance, region, regionLoaded])

  // Build sidebar items: EC2 instances + S3 storage classes
  const instances = meta[region] || []
  const s3Classes = regionLoaded ? getS3Classes(region) : []
  const s3Items = s3Classes.map(cls => ({ t: `s3:${cls}`, p: 0, isS3: true, label: cls }))

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
        isS3={isS3}
      />
      <div className="main">
        <Sidebar
          instances={instances}
          s3Items={s3Items}
          currentInstance={instance}
          onSelect={setInstance}
        />
        <Chart
          data={isS3 ? null : chartData}
          s3Data={isS3 ? s3ChartData : null}
          chartType={chartType}
          activeIndicators={activeIndicators}
          granularity={usedGranularity}
          instance={isS3 ? 'S3' : instance}
          region={region}
          onDemandData={onDemandData}
          riData={riDataMemo}
          isS3={isS3}
        />
      </div>
      <Footer />
    </div>
  )
}

export default App
