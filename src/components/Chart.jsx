import { useEffect, useRef, useState } from 'react'
import { createChart, CrosshairMode, LineSeries, AreaSeries } from 'lightweight-charts'
import { calcSMA, calcBollinger, fillTimeGaps } from '../utils/indicators'

const INDICATOR_COLORS = {
  sma7: '#f59e0b',
  sma30: '#ec4899',
  sma90: '#8b5cf6',
}

const S3_COLORS = {
  'Standard': '#2563eb',
  'Standard-IA': '#f59e0b',
  'One Zone-IA': '#ec4899',
  'Glacier': '#10b981',
  'Glacier Deep Archive': '#06b6d4',
  'Glacier Instant Retrieval': '#8b5cf6',
  'Intelligent-Tiering FA': '#f97316',
  'Reduced Redundancy': '#6b7280',
}

const LAMBDA_COLORS = {
  'Compute (x86)': '#2563eb',
  'Compute (ARM)': '#10b981',
  'Requests': '#f59e0b',
  'Provisioned Compute': '#ec4899',
  'Provisioned Concurrency': '#8b5cf6',
}

const RDS_COLORS = {
  'MySQL': '#2563eb',
  'PostgreSQL': '#10b981',
}

const AZURE_COLOR = '#0078d4'
const GCP_COLOR = '#34a853'

export default function Chart({ data, s3Data, lambdaData, rdsData, chartType, activeIndicators, granularity, instance, region, onDemandData, riData, isS3, isLambda, isRDS, storageComparison }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'dark')
  const [hiddenS3Classes, setHiddenS3Classes] = useState(new Set())

  const toggleS3Class = (cls) => {
    setHiddenS3Classes(prev => {
      const next = new Set(prev)
      if (next.has(cls)) next.delete(cls)
      else next.add(cls)
      return next
    })
  }

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const hasS3 = isS3 && s3Data && Object.keys(s3Data).length > 0
    const hasLambda = isLambda && lambdaData && Object.keys(lambdaData).length > 0
    const hasRDS = isRDS && rdsData && Object.keys(rdsData).length > 0
    if (!containerRef.current || (!hasS3 && !hasLambda && !hasRDS && (!data || data.length === 0))) return

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const styles = getComputedStyle(document.documentElement)
    const bgColor = styles.getPropertyValue('--bg-primary').trim() || '#0c0c0c'
    const borderColor = styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.12)'
    const textColor = styles.getPropertyValue('--text-secondary').trim() || 'rgba(255,255,255,0.5)'
    const accentColor = styles.getPropertyValue('--accent').trim() || 'rgb(80, 120, 190)'

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: bgColor },
        textColor: textColor,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: borderColor, width: 1, style: 2, labelBackgroundColor: accentColor },
        horzLine: { color: borderColor, width: 1, style: 2, labelBackgroundColor: accentColor },
      },
      rightPriceScale: {
        borderColor: borderColor,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: borderColor,
        timeVisible: false,
        rightOffset: 5,
        minBarSpacing: 2,
      },
      handleScroll: { vertTouchDrag: false },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })

    chartRef.current = chart

    // S3 mode: one line per storage class
    if (isS3 && s3Data && typeof s3Data === 'object') {
      chart.applyOptions({
        rightPriceScale: { minMove: 0.001 },
      })
      const entries = Object.entries(s3Data)
      if (!hiddenS3Classes.has('aws'))
      for (let i = 0; i < entries.length; i++) {
        const [cls, points] = entries[i]
        if (!points || points.length === 0) continue
        const color = S3_COLORS[cls] || '#9ca3af'
        const priceFormat = { type: 'price', precision: 3, minMove: 0.001 }

        if (chartType === 'area' && entries.length === 1) {
          chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: color.replace(')', ', 0.3)').replace('rgb', 'rgba'),
            bottomColor: 'transparent',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: cls,
            priceFormat,
          }).setData(points)
        } else {
          chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: cls,
            priceFormat,
          }).setData(points)
        }
      }
      // Add Azure/GCP comparison price lines
      if (storageComparison) {
        const refOpts = { lineWidth: 1, lineStyle: 3, priceLineVisible: false, lastValueVisible: false,
          priceFormat: { type: 'price', precision: 3, minMove: 0.001 } }

        if (!hiddenS3Classes.has('azure'))
        for (const [label, price] of Object.entries(storageComparison.azure || {})) {
          const s = chart.addSeries(LineSeries, { ...refOpts, color: AZURE_COLOR, title: '' })
          // Create a flat line using the first and last dates from S3 data
          const allDates = Object.values(s3Data).flat().map(d => d.time).sort()
          if (allDates.length >= 2) {
            s.setData([
              { time: allDates[0], value: price },
              { time: allDates[allDates.length - 1], value: price },
            ])
          }
        }

        if (!hiddenS3Classes.has('gcp'))
        for (const [label, price] of Object.entries(storageComparison.gcp || {})) {
          const s = chart.addSeries(LineSeries, { ...refOpts, color: GCP_COLOR, title: '' })
          const allDates = Object.values(s3Data).flat().map(d => d.time).sort()
          if (allDates.length >= 2) {
            s.setData([
              { time: allDates[0], value: price },
              { time: allDates[allDates.length - 1], value: price },
            ])
          }
        }
      }

      chart.timeScale().fitContent()

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
        }
      })
      ro.observe(containerRef.current)
      return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
    }

    // Lambda mode: one line per pricing category
    if (isLambda && lambdaData && Object.keys(lambdaData).length > 0) {
      for (const [cat, points] of Object.entries(lambdaData)) {
        if (!points || points.length === 0) continue
        chart.addSeries(LineSeries, {
          color: LAMBDA_COLORS[cat] || '#9ca3af',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: cat,
          priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 },
        }).setData(points)
      }
      chart.timeScale().fitContent()
      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
      })
      ro.observe(containerRef.current)
      return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
    }

    // RDS mode: one line per engine
    if (isRDS && rdsData && Object.keys(rdsData).length > 0) {
      for (const [engine, points] of Object.entries(rdsData)) {
        if (!points || points.length === 0) continue
        chart.addSeries(LineSeries, {
          color: RDS_COLORS[engine] || '#9ca3af',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: engine,
        }).setData(points)
      }
      chart.timeScale().fitContent()
      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
      })
      ro.observe(containerRef.current)
      return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
    }

    const linePoints = data.map(d => ({ time: d.date, value: d.avg }))
    const filled = fillTimeGaps(linePoints, granularity)
    const chartData = filled.map(d => ({ time: d.time, value: d.noData ? undefined : d.value }))

    let mainSeries
    if (chartType === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: '#2563eb',
        topColor: 'rgba(37, 99, 235, 0.3)',
        bottomColor: 'rgba(37, 99, 235, 0.02)',
        lineWidth: 2,
      })
    } else {
      mainSeries = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2 })
    }
    mainSeries.setData(chartData)

    // Indicators
    if (activeIndicators.size > 0) {
      const realData = data.map(d => ({ time: d.date, value: d.avg }))

      const smaConfigs = [
        { key: 'sma7', period: 7 },
        { key: 'sma30', period: 30 },
        { key: 'sma90', period: 90 },
      ]

      for (const cfg of smaConfigs) {
        if (activeIndicators.has(cfg.key)) {
          const s = chart.addSeries(LineSeries, {
            color: INDICATOR_COLORS[cfg.key],
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          })
          s.setData(calcSMA(realData, cfg.period))
        }
      }

      if (activeIndicators.has('bb')) {
        const bb = calcBollinger(realData, 20, 2)
        const bbOpts = { color: 'rgba(139, 92, 246, 0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }
        chart.addSeries(LineSeries, bbOpts).setData(bb.upper)
        chart.addSeries(LineSeries, bbOpts).setData(bb.lower)
        chart.addSeries(LineSeries, { ...bbOpts, lineStyle: 2 }).setData(bb.mid)
      }
    }

    // Reference price lines (on-demand, RI)
    const refLineOpts = { lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true }

    if (Array.isArray(onDemandData) && onDemandData.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: '#ef4444', lineWidth: 2, title: 'On-Demand' })
        .setData(onDemandData)
    }

    if (riData && Array.isArray(riData.ri1yNoUpfront) && riData.ri1yNoUpfront.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: '#f59e0b', title: '1yr RI' })
        .setData(riData.ri1yNoUpfront)
    }

    if (riData && Array.isArray(riData.ri3yNoUpfront) && riData.ri3yNoUpfront.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: '#10b981', title: '3yr RI' })
        .setData(riData.ri3yNoUpfront)
    }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [data, s3Data, lambdaData, rdsData, isS3, isLambda, isRDS, chartType, activeIndicators, granularity, theme, onDemandData, riData, hiddenS3Classes])

  return (
    <div className="chart-area">
      <div className="y-axis-label">
        {isS3 ? 'Price (USD / GB / mo)' : isLambda ? 'Price (USD)' : 'Price (USD / hr)'}
      </div>
      {instance && (
        <div className="chart-title">
          <span className="instance-name">{isS3 ? 'S3 Storage' : isLambda ? 'Lambda' : isRDS ? instance : instance}</span>
          {' '}&mdash; {region} &mdash;{' '}
          {isS3 ? 'Price per GB per Month' : isLambda ? 'Serverless Pricing' : isRDS ? 'RDS Hourly Rate (USD)' : 'EC2 Hourly Rate (USD)'}
        </div>
      )}
      {isS3 && s3Data && (
        <div className="s3-legend">
          <div
            className={`s3-legend-item ${hiddenS3Classes.has('aws') ? 'inactive' : 'active'}`}
            onClick={() => toggleS3Class('aws')}
          >
            <div className="s3-legend-checkbox">
              <div className="s3-legend-checkbox-inner" style={{ backgroundColor: '#f59e0b' }} />
            </div>
            AWS S3
          </div>
          {storageComparison && storageComparison.azure && (
            <div
              className={`s3-legend-item ${hiddenS3Classes.has('azure') ? 'inactive' : 'active'}`}
              onClick={() => toggleS3Class('azure')}
            >
              <div className="s3-legend-checkbox">
                <div className="s3-legend-checkbox-inner" style={{ backgroundColor: AZURE_COLOR }} />
              </div>
              Azure Blob
            </div>
          )}
          {storageComparison && storageComparison.gcp && (
            <div
              className={`s3-legend-item ${hiddenS3Classes.has('gcp') ? 'inactive' : 'active'}`}
              onClick={() => toggleS3Class('gcp')}
            >
              <div className="s3-legend-checkbox">
                <div className="s3-legend-checkbox-inner" style={{ backgroundColor: GCP_COLOR }} />
              </div>
              Google Cloud
            </div>
          )}
        </div>
      )}
      <div className="chart-container" ref={containerRef} />
      {(!data || data.length === 0) && !isS3 && !isLambda && !isRDS && (
        <div className="no-data-msg">
          {instance ? 'No data for this instance type in the selected time range' : 'Select an instance type'}
        </div>
      )}
    </div>
  )
}
