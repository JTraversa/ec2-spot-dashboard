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
  const { meta, loading, loadRegion, getInstanceData, getOnDemandData, getRIData, getS3Data, getS3Classes, getLambdaData, getLambdaCategories, getRDSData, getRDSInstances, getStorageComparison } = useSpotData()

  const [region, setRegion] = useState('us-east-1')
  const [instance, setInstance] = useState(null)
  const [chartType, setChartType] = useState('line')
  const [timeRange, setTimeRange] = useState(90)
  const [granularity, setGranularity] = useState('daily')
  const [activeIndicators, setActiveIndicators] = useState(new Set())
  const [regionLoaded, setRegionLoaded] = useState(false)

  // Track service type from selection
  const isS3 = instance === 's3:all'
  const isLambda = instance === 'lambda:all'
  const isRDS = instance && instance.startsWith('rds:')
  const rdsType = isRDS ? instance.slice(4) : null
  const isEC2 = !isS3 && !isLambda && !isRDS

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

  // Lambda chart data — all categories as a map
  const lambdaChartData = useMemo(() => {
    if (!isLambda || !regionLoaded) return {}
    const cats = getLambdaCategories(region)
    const result = {}
    for (const cat of cats) {
      const data = getLambdaData(region, cat)
      if (data.length > 0) result[cat] = data
    }
    return result
  }, [isLambda, region, regionLoaded])

  // RDS chart data — MySQL and PostgreSQL on same chart
  const rdsChartData = useMemo(() => {
    if (!isRDS || !regionLoaded || !rdsType) return {}
    const result = {}
    for (const engine of ['MySQL', 'PostgreSQL']) {
      const data = getRDSData(region, rdsType, engine)
      if (data.length > 0) result[engine] = data
    }
    return result
  }, [isRDS, rdsType, region, regionLoaded])

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

    if (isLambda) {
      const computeData = lambdaChartData['Compute (x86)'] || []
      if (computeData.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = computeData[computeData.length - 1]
      const first = computeData[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '\u25B2' : '\u25BC'
      return {
        chartData: [],
        usedGranularity: 'monthly',
        stats: {
          price: `$${latest.value.toFixed(10)}`,
          change: `${icon} ${Math.abs(change).toFixed(1)}%`,
          changeClass,
          range: `—`,
          granularity: `${Object.keys(lambdaChartData).length} pricing tiers`,
        },
      }
    }

    if (isRDS) {
      const mysqlData = rdsChartData['MySQL'] || []
      if (mysqlData.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = mysqlData[mysqlData.length - 1]
      const first = mysqlData[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '\u25B2' : '\u25BC'
      return {
        chartData: [],
        usedGranularity: 'monthly',
        stats: {
          price: `$${latest.value.toFixed(4)}/hr`,
          change: `${icon} ${Math.abs(change).toFixed(1)}%`,
          changeClass,
          range: `—`,
          granularity: `MySQL & PostgreSQL`,
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
  }, [isS3, isLambda, isRDS, s3ChartData, lambdaChartData, rdsChartData, instance, region, granularity, timeRange, regionLoaded, getInstanceData])

  const getExportData = useCallback(() => {
    return chartData.map(d => ({
      date: d.date, instance_type: d.instance_type, region,
      open: d.open, high: d.high, low: d.low, close: d.close, avg: d.avg,
    }))
  }, [chartData, region])

  const onDemandData = useMemo(() => {
    if (!isEC2 || !instance || !regionLoaded) return []
    return getOnDemandData(instance, region)
  }, [isEC2, instance, region, regionLoaded])

  const riDataMemo = useMemo(() => {
    if (!isEC2 || !instance || !regionLoaded) return null
    return {
      ri1yNoUpfront: getRIData(instance, region, 'ri_1y_no_upfront_standard'),
      ri3yNoUpfront: getRIData(instance, region, 'ri_3y_no_upfront_standard'),
    }
  }, [isEC2, instance, region, regionLoaded])

  // Build sidebar items
  const instances = meta[region] || []
  const s3Classes = regionLoaded ? getS3Classes(region) : []
  const s3Items = s3Classes.map(cls => ({ t: `s3:${cls}`, p: 0 }))
  const lambdaCats = regionLoaded ? getLambdaCategories(region) : []
  const rdsItems = regionLoaded ? getRDSInstances(region) : []
  const isNonEC2 = isS3 || isLambda || isRDS

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
        isS3={isNonEC2}
      />
      <div className="main">
        <Sidebar
          instances={instances}
          s3Items={s3Items}
          lambdaItems={lambdaCats}
          rdsItems={rdsItems}
          currentInstance={instance}
          onSelect={setInstance}
        />
        <Chart
          data={isEC2 ? chartData : null}
          s3Data={isS3 ? s3ChartData : null}
          lambdaData={isLambda ? lambdaChartData : null}
          rdsData={isRDS ? rdsChartData : null}
          chartType={chartType}
          activeIndicators={isEC2 ? activeIndicators : new Set()}
          granularity={usedGranularity}
          instance={isS3 ? 'S3' : isLambda ? 'Lambda' : isRDS ? rdsType : instance}
          region={region}
          onDemandData={onDemandData}
          riData={riDataMemo}
          isS3={isS3}
          isLambda={isLambda}
          isRDS={isRDS}
          storageComparison={isS3 && regionLoaded ? getStorageComparison(region) : null}
        />
      </div>
      <Footer />
    </div>
  )
}

export default App
