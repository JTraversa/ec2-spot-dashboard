import { useEffect, useRef, useState } from 'react'
import { createChart, CrosshairMode, LineSeries, AreaSeries } from 'lightweight-charts'
import { calcSMA, calcBollinger, resampleProportional } from '../utils/indicators'
import { PRIMARY, SLOTS, OTHER, CHART_SURFACE, CHART_GRID, CHART_TEXT, CHART_BORDER, tint } from '../charts/palette'

// Every chart gives its primary series ink and hands the fixed slots out in the
// order below. Series a chart can show beyond ink plus six slots fold into the
// neutral OTHER style; they keep their direct label on the price axis.

// EC2 and VM spot: spot price is primary, then the reference lines, then the
// indicators. Bollinger bands are an envelope, drawn in the neutral style.
const EC2_COLORS = {
  onDemand: SLOTS[0],
  ri1y: SLOTS[1],
  ri3y: SLOTS[2],
  sma7: SLOTS[3],
  sma30: SLOTS[4],
  sma90: SLOTS[5],
  bollinger: OTHER,
}

// S3: Standard is primary (the header stats use it). Four more classes take
// slots 1 to 4 and the Azure and Google Cloud reference lines take 5 and 6.
// One Zone-IA, Intelligent-Tiering FA (priced as Standard) and the retired
// Reduced Redundancy class fold into OTHER.
const S3_COLORS = {
  'Standard': PRIMARY,
  'Standard-IA': SLOTS[0],
  'Glacier Instant Retrieval': SLOTS[1],
  'Glacier': SLOTS[2],
  'Glacier Deep Archive': SLOTS[3],
}
const AZURE_COLOR = SLOTS[4]
const GCP_COLOR = SLOTS[5]

const LAMBDA_COLORS = {
  'Compute (x86)': PRIMARY,
  'Compute (ARM)': SLOTS[0],
  'Requests': SLOTS[1],
  'Provisioned Compute': SLOTS[2],
  'Provisioned Concurrency': SLOTS[3],
}

const RDS_COLORS = {
  'MySQL': PRIMARY,
  'PostgreSQL': SLOTS[0],
}

const EBS_COLORS = {
  'gp3': PRIMARY,
  'gp2': SLOTS[0],
  'io2': SLOTS[1],
  'io1': SLOTS[2],
  'st1': SLOTS[3],
  'sc1': SLOTS[4],
}

const TRANSFER_COLORS = {
  'Internet (0-10 TB)': PRIMARY,
  'Internet (10-50 TB)': SLOTS[0],
  'Internet (50-150 TB)': SLOTS[1],
  'Cross-Region': SLOTS[2],
  'Cross-AZ': SLOTS[3],
}

// Sentence-case display names for series keys that arrive title-cased in the
// data. AWS product names (S3 classes, EBS types) are kept as AWS writes them.
const SERIES_LABELS = {
  'Provisioned Compute': 'Provisioned compute',
  'Provisioned Concurrency': 'Provisioned concurrency',
  'Cross-Region': 'Cross-region',
}
const seriesLabel = (key) => SERIES_LABELS[key] || key
const lineWidthFor = (color) => (color === OTHER ? 1 : 2)

export default function Chart({ data, s3Data, lambdaData, rdsData, ebsData, transferData, chartType, activeIndicators, granularity, visibleRange, denseFrom, instance, region, onDemandData, riData, isS3, isLambda, isRDS, isEBS, isTransfer, storageComparison }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
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
    const hasS3 = isS3 && s3Data && Object.keys(s3Data).length > 0
    const hasLambda = isLambda && lambdaData && Object.keys(lambdaData).length > 0
    const hasRDS = isRDS && rdsData && Object.keys(rdsData).length > 0
    const hasEBSData = isEBS && ebsData && Object.keys(ebsData).length > 0
    const hasTransferData = isTransfer && transferData && Object.keys(transferData).length > 0
    if (!containerRef.current || (!hasS3 && !hasLambda && !hasRDS && !hasEBSData && !hasTransferData && (!data || data.length === 0))) return

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: CHART_SURFACE },
        textColor: CHART_TEXT,
        fontSize: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: CHART_GRID },
        horzLines: { color: CHART_GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CHART_BORDER, width: 1, style: 2, labelBackgroundColor: PRIMARY },
        horzLine: { color: CHART_BORDER, width: 1, style: 2, labelBackgroundColor: PRIMARY },
      },
      rightPriceScale: {
        borderColor: CHART_BORDER,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: CHART_BORDER,
        timeVisible: false,
        rightOffset: 5,
        // Low floor so fitContent can fit deep history: the spot series is
        // resampled to a daily grid, so ALL on a 10-year instance is ~3,600
        // bars; the old floor of 2px capped the window at ~2 years.
        minBarSpacing: 0.05,
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
        const color = S3_COLORS[cls] || OTHER
        const priceFormat = { type: 'price', precision: 3, minMove: 0.001 }

        if (chartType === 'area' && entries.length === 1) {
          chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: tint(color, 0.12),
            bottomColor: tint(color, 0.01),
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: cls,
            priceFormat,
          }).setData(points)
        } else {
          chart.addSeries(LineSeries, {
            color,
            lineWidth: lineWidthFor(color),
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
        for (const price of Object.values(storageComparison.azure || {})) {
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
        for (const price of Object.values(storageComparison.gcp || {})) {
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
        const color = LAMBDA_COLORS[cat] || OTHER
        chart.addSeries(LineSeries, {
          color,
          lineWidth: lineWidthFor(color),
          priceLineVisible: false,
          lastValueVisible: true,
          title: seriesLabel(cat),
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
        const color = RDS_COLORS[engine] || OTHER
        chart.addSeries(LineSeries, {
          color,
          lineWidth: lineWidthFor(color),
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

    // EBS mode: one line per volume type
    if (isEBS && ebsData && Object.keys(ebsData).length > 0) {
      chart.applyOptions({ rightPriceScale: { minMove: 0.001 } })
      for (const [volType, points] of Object.entries(ebsData)) {
        if (!points || points.length === 0) continue
        const color = EBS_COLORS[volType] || OTHER
        chart.addSeries(LineSeries, {
          color,
          lineWidth: lineWidthFor(color),
          priceLineVisible: false,
          lastValueVisible: true,
          title: volType,
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        }).setData(points)
      }
      chart.timeScale().fitContent()
      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
      })
      ro.observe(containerRef.current)
      return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
    }

    // Transfer mode: one line per transfer type
    if (isTransfer && transferData && Object.keys(transferData).length > 0) {
      chart.applyOptions({ rightPriceScale: { minMove: 0.001 } })
      for (const [txType, points] of Object.entries(transferData)) {
        if (!points || points.length === 0) continue
        const color = TRANSFER_COLORS[txType] || OTHER
        chart.addSeries(LineSeries, {
          color,
          lineWidth: lineWidthFor(color),
          priceLineVisible: false,
          lastValueVisible: true,
          title: seriesLabel(txType),
          priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
        }).setData(points)
      }
      chart.timeScale().fitContent()
      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
      })
      ro.observe(containerRef.current)
      return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
    }

    // Resample onto a daily grid so the (ordinal) time axis is proportional to
    // real time; interpolates across normal gaps, breaks across multi-month holes.
    const linePoints = data.map(d => ({ time: d.date, value: d.avg }))
    const filled = resampleProportional(linePoints)
    const chartData = filled.map(d => ({ time: d.time, value: d.noData ? undefined : d.value }))

    let mainSeries
    if (chartType === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: PRIMARY,
        topColor: tint(PRIMARY, 0.12),
        bottomColor: tint(PRIMARY, 0.01),
        lineWidth: 2,
        title: 'Spot price',
      })
    } else {
      mainSeries = chart.addSeries(LineSeries, { color: PRIMARY, lineWidth: 2, title: 'Spot price' })
    }
    mainSeries.setData(chartData)

    // Indicators
    if (activeIndicators.size > 0) {
      // Indicators only make sense on the dense native series: skip the sparse
      // pre-2024 monthly tail that may be prepended for daily/weekly views.
      const realData = data
        .filter(d => !denseFrom || d.date >= denseFrom)
        .map(d => ({ time: d.date, value: d.avg }))

      const smaConfigs = [
        { key: 'sma7', period: 7, title: 'SMA 7' },
        { key: 'sma30', period: 30, title: 'SMA 30' },
        { key: 'sma90', period: 90, title: 'SMA 90' },
      ]

      for (const cfg of smaConfigs) {
        if (activeIndicators.has(cfg.key)) {
          const s = chart.addSeries(LineSeries, {
            color: EC2_COLORS[cfg.key],
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: cfg.title,
          })
          s.setData(calcSMA(realData, cfg.period))
        }
      }

      if (activeIndicators.has('bb')) {
        const bb = calcBollinger(realData, 20, 2)
        const bbOpts = { color: EC2_COLORS.bollinger, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }
        chart.addSeries(LineSeries, bbOpts).setData(bb.upper)
        chart.addSeries(LineSeries, bbOpts).setData(bb.lower)
        chart.addSeries(LineSeries, { ...bbOpts, lineStyle: 2 }).setData(bb.mid)
      }
    }

    // Reference price lines (on-demand, RI): consistent dashed weight so the
    // 1yr/3yr RI lines read as clearly as On-Demand at any resolution.
    const refLineOpts = { lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: true }

    if (Array.isArray(onDemandData) && onDemandData.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: EC2_COLORS.onDemand, title: 'On-demand' })
        .setData(onDemandData)
    }

    if (riData && Array.isArray(riData.ri1yNoUpfront) && riData.ri1yNoUpfront.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: EC2_COLORS.ri1y, title: '1-year RI' })
        .setData(riData.ri1yNoUpfront)
    }

    if (riData && Array.isArray(riData.ri3yNoUpfront) && riData.ri3yNoUpfront.length > 0) {
      chart.addSeries(LineSeries, { ...refLineOpts, color: EC2_COLORS.ri3y, title: '3-year RI' })
        .setData(riData.ri3yNoUpfront)
    }

    // Full history is loaded; the range preset just frames the initial window
    // (the user can still pan/zoom across everything). ALL → fit the whole span.
    if (visibleRange) {
      try { chart.timeScale().setVisibleRange(visibleRange) }
      catch { chart.timeScale().fitContent() }
    } else {
      chart.timeScale().fitContent()
    }

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
  }, [data, s3Data, lambdaData, rdsData, ebsData, transferData, isS3, isLambda, isRDS, isEBS, isTransfer, chartType, activeIndicators, granularity, denseFrom, onDemandData, riData, hiddenS3Classes])  // eslint-disable-line react-hooks/exhaustive-deps -- visibleRange applied in its own effect

  // Range-preset changes only move the viewport; no need to rebuild the chart.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !data || data.length === 0) return
    if (visibleRange) {
      try { chart.timeScale().setVisibleRange(visibleRange) }
      catch { chart.timeScale().fitContent() }
    } else {
      chart.timeScale().fitContent()
    }
  }, [visibleRange, data])

  return (
    <div className="chart-area">
      <div className="y-axis-label">
        {isS3 || isEBS ? 'Price (USD per GB-month)' : isTransfer ? 'Price (USD per GB)' : isLambda ? 'Price (USD)' : 'Hourly rate (USD)'}
      </div>
      {instance && (
        <div className="chart-title">
          <span className="instance-name">{isS3 ? 'S3 storage' : isLambda ? 'Lambda' : isRDS ? instance : isEBS ? 'EBS block storage' : isTransfer ? 'Data transfer' : instance}</span>
          {' · '}{region}{' · '}
          {isS3 ? 'Price per GB per month' : isLambda ? 'Serverless pricing' : isRDS ? 'RDS hourly rate (USD)' : isEBS ? 'Storage per GB per month' : isTransfer ? 'Egress and transfer per GB' : 'Hourly rate (USD)'}
        </div>
      )}
      {isS3 && s3Data && (
        <div className="s3-legend">
          <div
            className={`s3-legend-item ${hiddenS3Classes.has('aws') ? 'inactive' : 'active'}`}
            onClick={() => toggleS3Class('aws')}
          >
            <div className="s3-legend-checkbox">
              <div className="s3-legend-checkbox-inner" style={{ backgroundColor: PRIMARY }} />
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
      {(!data || data.length === 0) && !isS3 && !isLambda && !isRDS && !isEBS && !isTransfer && (
        <div className="no-data-msg">
          {instance ? 'No data for this instance type in the selected time range.' : 'Select an instance type.'}
        </div>
      )}
    </div>
  )
}
