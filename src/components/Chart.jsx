import { useEffect, useRef, useState } from 'react'
import { createChart, CrosshairMode, LineSeries, AreaSeries } from 'lightweight-charts'
import { calcSMA, calcBollinger, fillTimeGaps } from '../utils/indicators'

const INDICATOR_COLORS = {
  sma7: '#f59e0b',
  sma30: '#ec4899',
  sma90: '#8b5cf6',
}

export default function Chart({ data, chartType, activeIndicators, granularity, instance, region }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'dark')

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!containerRef.current || !data || data.length === 0) return

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
  }, [data, chartType, activeIndicators, granularity, theme])

  return (
    <div className="chart-area">
      <div className="y-axis-label">Spot Price (USD / hr)</div>
      {instance && (
        <div className="chart-title">
          <span className="instance-name">{instance}</span> &mdash; {region} &mdash; EC2 Spot Instance Avg. Hourly Rate (USD)
        </div>
      )}
      <div className="chart-container" ref={containerRef} />
      {(!data || data.length === 0) && (
        <div className="no-data-msg">
          {instance ? 'No data for this instance type in the selected time range' : 'Select an instance type'}
        </div>
      )}
    </div>
  )
}
