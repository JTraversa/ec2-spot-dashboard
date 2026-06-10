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

const DEFAULT_REGION = { aws: 'us-east-1', gcp: 'us-central1', azure: 'us-east' }

// Land on a recognizable general-purpose instance rather than whatever sorts
// first alphabetically (a1.2xlarge / a2-highgpu-1g / D16als_v7). First match wins.
const PREFERRED_DEFAULT = {
  aws: ['m5.large', 'm6i.large', 'c5.large', 't3.medium'],
  gcp: ['n2-standard-4', 'e2-standard-4', 'n1-standard-4', 'n2-standard-2'],
  azure: ['D4s_v5', 'D2s_v5', 'D4as_v5'],
}

function App() {
  const { meta, loading, loadRegion, loadInstance, getAllRegionInstances, getInstanceData, getOnDemandData, getRIData, getS3Data, getS3Classes, getLambdaData, getLambdaCategories, getRDSData, getRDSInstances, getStorageComparison, getEBSData, getEBSTypes, getTransferData, getTransferTypes } = useSpotData()

  const [provider, setProviderState] = useState('aws')
  const [region, setRegion] = useState('us-east-1')
  const [instance, setInstance] = useState(null)
  const [chartType, setChartType] = useState('line')
  const [timeRange, setTimeRange] = useState(365)
  const [granularity, setGranularity] = useState('daily')
  const [activeIndicators, setActiveIndicators] = useState(new Set())
  const [regionLoaded, setRegionLoaded] = useState(false)
  const [instanceLoaded, setInstanceLoaded] = useState(false)

  // Service type encoded in the selection string
  const isS3 = instance === 's3:all'
  const isLambda = instance === 'lambda:all'
  const isRDS = instance && instance.startsWith('rds:')
  const rdsType = isRDS ? instance.slice(4) : null
  const isEBS = instance === 'ebs:all'
  const isTransfer = instance === 'transfer:all'
  const isEC2 = !isS3 && !isLambda && !isRDS && !isEBS && !isTransfer
  const isAWS = provider === 'aws'

  useEffect(() => {
    if (!loading) {
      loadRegion(provider, region).then(() => setRegionLoaded(true))
    }
  }, [loading, provider, region])

  useEffect(() => {
    if (regionLoaded && meta[provider] && meta[provider][region] && !instance) {
      const instances = meta[provider][region]
      if (instances.length === 0) return
      const types = instances.map(i => i.t)
      const preferred = (PREFERRED_DEFAULT[provider] || []).find(t => types.includes(t))
      setInstance(preferred || instances[0].t)
    }
  }, [regionLoaded, meta, provider, region])

  // Load the selected instance's per-instance spot file (EC2 only).
  useEffect(() => {
    if (!regionLoaded || !instance || !isEC2) return
    setInstanceLoaded(false)
    loadInstance(provider, region, instance).then(() => setInstanceLoaded(true))
  }, [regionLoaded, provider, region, instance, isEC2])

  const handleProviderChange = useCallback(async (newProvider) => {
    const newRegion = DEFAULT_REGION[newProvider]
    setProviderState(newProvider)
    setRegion(newRegion)
    setInstance(null)
    setRegionLoaded(false)
    await loadRegion(newProvider, newRegion)
    setRegionLoaded(true)
  }, [loadRegion])

  const handleRegionChange = useCallback(async (newRegion) => {
    setRegion(newRegion)
    setInstance(null)
    setRegionLoaded(false)
    await loadRegion(provider, newRegion)
    setRegionLoaded(true)
  }, [loadRegion, provider])

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
    const classes = getS3Classes(provider, region)
    const result = {}
    for (const cls of classes) {
      const data = getS3Data(provider, region, cls)
      if (data.length > 0) result[cls] = data
    }
    return result
  }, [isS3, provider, region, regionLoaded])

  // Lambda chart data — all categories as a map
  const lambdaChartData = useMemo(() => {
    if (!isLambda || !regionLoaded) return {}
    const cats = getLambdaCategories(provider, region)
    const result = {}
    for (const cat of cats) {
      const data = getLambdaData(provider, region, cat)
      if (data.length > 0) result[cat] = data
    }
    return result
  }, [isLambda, provider, region, regionLoaded])

  // RDS chart data — MySQL and PostgreSQL on same chart
  const rdsChartData = useMemo(() => {
    if (!isRDS || !regionLoaded || !rdsType) return {}
    const result = {}
    for (const engine of ['MySQL', 'PostgreSQL']) {
      const data = getRDSData(provider, region, rdsType, engine)
      if (data.length > 0) result[engine] = data
    }
    return result
  }, [isRDS, rdsType, provider, region, regionLoaded])

  // EBS chart data — all volume types as a map
  const ebsChartData = useMemo(() => {
    if (!isEBS || !regionLoaded) return {}
    const types = getEBSTypes(provider, region)
    const result = {}
    for (const t of types) {
      const data = getEBSData(provider, region, t)
      if (data.length > 0) result[t] = data
    }
    return result
  }, [isEBS, provider, region, regionLoaded])

  // Transfer chart data — all transfer types as a map
  const transferChartData = useMemo(() => {
    if (!isTransfer || !regionLoaded) return {}
    const types = getTransferTypes(provider, region)
    const result = {}
    for (const t of types) {
      const data = getTransferData(provider, region, t)
      if (data.length > 0) result[t] = data
    }
    return result
  }, [isTransfer, provider, region, regionLoaded])

  // EC2/spot chart data + stats. The chart receives the FULL series; the range
  // preset only sets the initial visible window (the chart can still pan/zoom),
  // and stats are computed over that window.
  const { chartData, stats, usedGranularity, visibleRange, denseFrom } = useMemo(() => {
    if (isS3) {
      const stdData = s3ChartData['Standard'] || []
      if (stdData.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = stdData[stdData.length - 1]
      const first = stdData[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '▲' : '▼'
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
      const icon = change >= 0 ? '▲' : '▼'
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
      const icon = change >= 0 ? '▲' : '▼'
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

    if (isEBS) {
      const gp3Data = ebsChartData['gp3'] || ebsChartData['gp2'] || []
      if (gp3Data.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = gp3Data[gp3Data.length - 1]
      const first = gp3Data[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '▲' : '▼'
      return {
        chartData: [],
        usedGranularity: 'monthly',
        stats: {
          price: `$${latest.value.toFixed(3)}/GB-mo`,
          change: change === 0 ? '— 0%' : `${icon} ${Math.abs(change).toFixed(1)}%`,
          changeClass: change === 0 ? 'neutral' : changeClass,
          range: `—`,
          granularity: `${Object.keys(ebsChartData).length} volume types`,
        },
      }
    }

    if (isTransfer) {
      const egressData = transferChartData['Internet (0-10 TB)'] || []
      if (egressData.length === 0) return { chartData: [], stats: {}, usedGranularity: 'monthly' }
      const latest = egressData[egressData.length - 1]
      const first = egressData[0]
      const change = ((latest.value - first.value) / first.value * 100)
      const changeClass = change >= 0 ? 'up' : 'down'
      const icon = change >= 0 ? '▲' : '▼'
      return {
        chartData: [],
        usedGranularity: 'monthly',
        stats: {
          price: `$${latest.value.toFixed(3)}/GB`,
          change: `${icon} ${Math.abs(change).toFixed(1)}%`,
          changeClass,
          range: `—`,
          granularity: `${Object.keys(transferChartData).length} transfer types`,
        },
      }
    }

    if (!instance || !instanceLoaded) return { chartData: [], stats: {}, usedGranularity: granularity, visibleRange: null, denseFrom: null }

    const result = getInstanceData(instance, provider, region, granularity)
    const full = result.data
    if (full.length === 0) return { chartData: [], stats: {}, usedGranularity: result.actualGranularity, visibleRange: null, denseFrom: null }

    // Compute the visible window from the range preset (chart still pans freely).
    const lastDate = full[full.length - 1].date
    let windowData = full
    let visRange = null
    if (timeRange !== 'all') {
      const cutoff = new Date(lastDate)
      cutoff.setDate(cutoff.getDate() - timeRange)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      windowData = full.filter(d => d.date >= cutoffStr)
      visRange = { from: cutoffStr, to: lastDate }
    }

    const statSrc = windowData.length ? windowData : full
    const latest = statSrc[statSrc.length - 1]
    const firstPt = statSrc[0]
    const change = ((latest.avg - firstPt.avg) / firstPt.avg * 100)
    const changeClass = change >= 0 ? 'up' : 'down'
    const icon = change >= 0 ? '▲' : '▼'
    const allAvgs = statSrc.map(d => d.avg)

    return {
      chartData: full,
      usedGranularity: result.actualGranularity,
      visibleRange: visRange,
      denseFrom: result.denseFrom,
      stats: {
        price: `$${latest.avg.toFixed(4)}`,
        change: `${icon} ${Math.abs(change).toFixed(2)}%`,
        changeClass,
        range: `$${Math.min(...allAvgs).toFixed(4)} — $${Math.max(...allAvgs).toFixed(4)}`,
        granularity: `${GRANULARITY_LABELS[result.actualGranularity]} (${statSrc.length} pts)`,
      },
    }
  }, [isS3, isLambda, isRDS, isEBS, isTransfer, s3ChartData, lambdaChartData, rdsChartData, ebsChartData, transferChartData, instance, provider, region, granularity, timeRange, instanceLoaded, getInstanceData])

  const getExportData = useCallback(() => {
    return chartData.map(d => ({
      date: d.date, instance_type: instance, region,
      open: d.open, high: d.high, low: d.low, close: d.close, avg: d.avg,
    }))
  }, [chartData, instance, region])

  const onDemandData = useMemo(() => {
    if (!isEC2 || !isAWS || !instance || !instanceLoaded) return []
    return getOnDemandData(instance, provider, region)
  }, [isEC2, isAWS, instance, provider, region, instanceLoaded])

  const riDataMemo = useMemo(() => {
    if (!isEC2 || !isAWS || !instance || !instanceLoaded) return null
    return {
      ri1yNoUpfront: getRIData(instance, provider, region, 'ri_1y_no_upfront_standard'),
      ri3yNoUpfront: getRIData(instance, provider, region, 'ri_3y_no_upfront_standard'),
    }
  }, [isEC2, isAWS, instance, provider, region, instanceLoaded])

  // Build sidebar items
  const instances = (meta[provider] && meta[provider][region]) || []
  const allInstances = useMemo(() => regionLoaded ? getAllRegionInstances(provider, region) : [], [provider, region, regionLoaded])
  const s3Classes = isAWS && regionLoaded ? getS3Classes(provider, region) : []
  const s3Items = s3Classes.map(cls => ({ t: `s3:${cls}`, p: 0 }))
  const lambdaCats = isAWS && regionLoaded ? getLambdaCategories(provider, region) : []
  const rdsItems = isAWS && regionLoaded ? getRDSInstances(provider, region) : []
  const hasEBS = isAWS && regionLoaded && getEBSTypes(provider, region).length > 0
  const hasTransfer = isAWS && regionLoaded && getTransferTypes(provider, region).length > 0
  const isNonEC2 = isS3 || isLambda || isRDS || isEBS || isTransfer

  return (
    <div className="app">
      <SiteHeader />
      <Socialicons />
      <Header provider={provider} stats={stats} />
      <Controls
        provider={provider} setProvider={handleProviderChange}
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
          key={provider + '/' + region}
          provider={provider}
          instances={instances}
          allInstances={allInstances}
          s3Items={s3Items}
          lambdaItems={lambdaCats}
          rdsItems={rdsItems}
          hasEBS={hasEBS}
          hasTransfer={hasTransfer}
          currentInstance={instance}
          onSelect={setInstance}
        />
        <Chart
          data={isEC2 ? chartData : null}
          s3Data={isS3 ? s3ChartData : null}
          lambdaData={isLambda ? lambdaChartData : null}
          rdsData={isRDS ? rdsChartData : null}
          ebsData={isEBS ? ebsChartData : null}
          transferData={isTransfer ? transferChartData : null}
          chartType={chartType}
          activeIndicators={isEC2 ? activeIndicators : new Set()}
          granularity={usedGranularity}
          visibleRange={isEC2 ? visibleRange : null}
          denseFrom={isEC2 ? denseFrom : null}
          instance={isS3 ? 'S3' : isLambda ? 'Lambda' : isRDS ? rdsType : isEBS ? 'EBS' : isTransfer ? 'Transfer' : instance}
          region={region}
          onDemandData={onDemandData}
          riData={riDataMemo}
          isS3={isS3}
          isLambda={isLambda}
          isRDS={isRDS}
          isEBS={isEBS}
          isTransfer={isTransfer}
          storageComparison={isS3 && regionLoaded ? getStorageComparison(provider, region) : null}
        />
      </div>
      <Footer />
    </div>
  )
}

export default App
