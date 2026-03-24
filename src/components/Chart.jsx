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

export default function Chart({ data, s3Data, chartType, activeIndicators, granularity, instance, region, onDemandData, riData, isS3 }) {
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
    if (!containerRef.current || (!hasS3 && (!data || data.length === 0))) return

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
      for (let i = 0; i < entries.length; i++) {
        const [cls, points] = entries[i]
        if (!points || points.length === 0) continue
        if (hiddenS3Classes.has(cls)) continue
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
      chart.timeScale().fitContent()

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
        }
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
  }, [data, s3Data, isS3, chartType, activeIndicators, granularity, theme, onDemandData, riData, hiddenS3Classes])

  return (
    <div className="chart-area">
      <div className="y-axis-label">{isS3 ? 'Price (USD / GB / mo)' : 'Price (USD / hr)'}</div>
      {instance && (
        <div className="chart-title">
          <span className="instance-name">{isS3 ? 'S3 Storage' : instance}</span> &mdash; {region} &mdash; {isS3 ? 'Price per GB per Month (USD)' : 'EC2 Hourly Rate (USD)'}
        </div>
      )}
      {isS3 && s3Data && (
        <div className="s3-legend">
          {Object.keys(s3Data).map(cls => (
            <div
              key={cls}
              className={`s3-legend-item ${hiddenS3Classes.has(cls) ? 'inactive' : 'active'}`}
              onClick={() => toggleS3Class(cls)}
            >
              <div className="s3-legend-checkbox">
                <div className="s3-legend-checkbox-inner" style={{ backgroundColor: S3_COLORS[cls] || '#9ca3af' }} />
              </div>
              {cls}
            </div>
          ))}
        </div>
      )}
      <div className="chart-container" ref={containerRef} />
      {(!data || data.length === 0) && (!s3Data || s3Data.length === 0) && (
        <div className="no-data-msg">
          {instance ? 'No data for this instance type in the selected time range' : 'Select an instance type'}
        </div>
      )}
    </div>
  )
}
