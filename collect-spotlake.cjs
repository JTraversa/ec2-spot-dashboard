#!/usr/bin/env node
/**
 * collect-spotlake.cjs
 * Fetches AWS, GCP, and Azure spot pricing history from SpotLake's TITANS API
 * and outputs JSON files matching the ec2-spot-dashboard data format.
 *
 * Usage:
 *   node collect-spotlake.cjs             # collect all providers
 *   node collect-spotlake.cjs aws         # AWS only (Linux/UNIX, clean data)
 *   node collect-spotlake.cjs gcp         # GCP only
 *   node collect-spotlake.cjs azure       # Azure only
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const TITANS = 'https://5nepzdkzaf.execute-api.us-west-2.amazonaws.com/query';
const OUT = path.join(__dirname, 'public', 'data');

// TITANS caps every query at this many events and silently truncates the rest.
// Any range that comes back at (or above) the cap is incomplete and must be split.
const CAP = 500000;

// The app picks granularity by time range (daily ≤3M, weekly ≤1Y, monthly = ALL),
// so older fine-grained data is never displayed. Trim each granularity to the
// window that actually uses it (plus a buffer) to keep the shipped JSON small —
// full daily history would be >100MB/region and exceed GitHub's file limit.
const DAILY_KEEP_DAYS = 120;   // covers the 90-day (3M) daily view
const WEEKLY_KEEP_DAYS = 400;  // covers the 365-day (1Y) weekly view
// monthly is kept in full (ALL view) — it's small.

// Popular Azure instances curated from SpotLake data (Standard_ prefix dropped)
const AZURE_INSTANCES = [
  // General purpose — D series (Intel)
  'D2s_v5', 'D4s_v5', 'D8s_v5', 'D16s_v5', 'D32s_v5',
  // General purpose — D series (AMD)
  'D2as_v5', 'D4as_v5', 'D8as_v5', 'D16as_v5',
  // General purpose — newer v6/v7
  'D4als_v7', 'D8als_v7', 'D16als_v7',
  'D4as_v6', 'D8as_v6', 'D16as_v6',
  // Compute optimized — F series
  'F2s_v2', 'F4s_v2', 'F8s_v2', 'F16s_v2',
  'F4als_v6', 'F8als_v6', 'F16als_v6',
  // Memory optimized — E series (Intel)
  'E2s_v5', 'E4s_v5', 'E8s_v5', 'E16s_v5', 'E32s_v5',
  // Memory optimized — E series (AMD)
  'E4as_v5', 'E8as_v5', 'E16as_v5',
  // Storage optimized — L series
  'L8s_v3', 'L16s_v3', 'L32s_v3',
  // GPU — NC T4 series (most accessible GPU tier)
  'NC4as_T4_v3', 'NC8as_T4_v3', 'NC16as_T4_v3',
];

const CONFIG = {
  aws: {
    regions: ['us-east-1', 'eu-west-1', 'us-west-2'],
    instanceTypes: ['all'],  // SpotLake AWS = Linux/UNIX only
    startDate: '2024-01-01',  // TITANS has no AWS parquet before early 2024
    chunkSize: 4,             // days — small chunks stay under the 500K/query cap
  },
  gcp: {
    regions: ['us-central1', 'us-east4', 'europe-west4'],
    instanceTypes: ['all'],
    startDate: '2024-06-01',
    chunkSize: 'month',
  },
  azure: {
    regions: ['US East', 'US West 2', 'EU West'],
    instanceTypes: AZURE_INSTANCES,
    startDate: '2025-06-01',
    chunkSize: 'week',
  },
};

const toSlug = r => r.toLowerCase().replace(/\s+/g, '-');

// ── API ──────────────────────────────────────────────────────────────────────

async function queryTITANS(provider, region, instanceTypes, start, end) {
  const body = JSON.stringify({
    provider,
    instance_types: instanceTypes,
    regions: [region],
    start,
    end,
    strategy: 'unified',
    azs: ['all'],
  });

  const res = await fetch(TITANS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('gzip')) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const buf = await res.arrayBuffer();
  const json = await new Promise((resolve, reject) =>
    zlib.gunzip(Buffer.from(buf), (err, data) =>
      err ? reject(err) : resolve(data.toString())
    )
  );

  const parsed = JSON.parse(json);
  if (parsed.error) throw new Error(parsed.message || parsed.error);
  return parsed.results || [];
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function dateRanges(startStr, endStr, size) {
  const ranges = [];
  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  while (cur < end) {
    const next = new Date(cur);
    if (size === 'month') {
      next.setUTCMonth(next.getUTCMonth() + 1);
    } else if (size === 'week') {
      next.setUTCDate(next.getUTCDate() + 7);
    } else {
      next.setUTCDate(next.getUTCDate() + Number(size));  // numeric: N days
    }
    const rangeEnd = next > end ? end : next;
    ranges.push({
      start: cur.toISOString().slice(0, 10),
      end: rangeEnd.toISOString().slice(0, 10),
    });
    cur = next;
  }
  return ranges;
}

function isoWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

// ── On-the-fly aggregation ────────────────────────────────────────────────────
// Accumulate events into daily buckets keyed by "instance::date"
// This keeps memory bounded regardless of raw event volume.

function makeAccumulator() {
  const daily = new Map();    // "inst::date" → { inst, date, prices:[], ondemand }
  const latestByInst = new Map(); // inst → { date, price, ondemand }

  function ingest(results) {
    for (const r of results) {
      const date = r.Time.slice(0, 10);
      const inst = r.InstanceType;
      const p = r.SpotPrice;
      // TITANS emits -1/0 as a "no price" sentinel — skip so it can't corrupt
      // the day's open/high/low/close/avg.
      if (!(p > 0)) continue;
      const key = `${inst}::${date}`;

      // Running OHLC + sum/count keeps memory bounded by the number of daily
      // buckets (not the raw event volume), so a full-history collect won't OOM.
      let b = daily.get(key);
      if (!b) { b = { inst, date, open: p, high: p, low: p, close: p, sum: 0, n: 0, ondemand: 0 }; daily.set(key, b); }
      if (p > b.high) b.high = p;
      if (p < b.low) b.low = p;
      b.close = p;
      b.sum += p;
      b.n += 1;
      // TITANS uses -1/0 as "no on-demand price" sentinels — only keep real ones.
      if (r.OndemandPrice > 0) b.ondemand = r.OndemandPrice;

      const prev = latestByInst.get(inst);
      if (!prev || date > prev.date) latestByInst.set(inst, { date, price: p });
    }
  }

  function finalize() {
    const dailyArr = [...daily.values()].map(({ inst, date, open, high, low, close, sum, n }) => ({
      date,
      instance_type: inst,
      open,
      high,
      low,
      close,
      avg: +(sum / n).toFixed(6),
      samples: n,
    })).sort((a, b) => a.date.localeCompare(b.date) || a.instance_type.localeCompare(b.instance_type));

    // On-demand: one record per instance per date (last seen valid price),
    // then collapsed to change-points (on-demand is a near-constant step
    // function — storing every day is ~100x larger for no extra information).
    const odMap = new Map();
    for (const { inst, date, ondemand } of daily.values()) {
      if (!(ondemand > 0)) continue;
      odMap.set(`${inst}::${date}`, { date, instance_type: inst, price: ondemand });
    }
    const ondemandArr = dedupeOndemand([...odMap.values()]);

    // Weekly rollup
    const weeklyMap = new Map();
    for (const d of dailyArr) {
      const week = isoWeekStart(d.date);
      const key = `${d.instance_type}::${week}`;
      if (!weeklyMap.has(key)) weeklyMap.set(key, { inst: d.instance_type, date: d.date, avgs: [] });
      const e = weeklyMap.get(key);
      if (d.date < e.date) e.date = d.date;
      e.avgs.push(d.avg);
    }

    // Monthly rollup
    const monthlyMap = new Map();
    for (const d of dailyArr) {
      const month = d.date.slice(0, 7) + '-01';
      const key = `${d.instance_type}::${month}`;
      if (!monthlyMap.has(key)) monthlyMap.set(key, { inst: d.instance_type, date: d.date, avgs: [] });
      const e = monthlyMap.get(key);
      if (d.date < e.date) e.date = d.date;
      e.avgs.push(d.avg);
    }

    const rollup = map => [...map.values()].map(({ inst, date, avgs }) => ({
      date,
      instance_type: inst,
      open: avgs[0],
      high: Math.max(...avgs),
      low: Math.min(...avgs),
      close: avgs[avgs.length - 1],
      avg: +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(6),
      samples: avgs.length,
    })).sort((a, b) => a.date.localeCompare(b.date) || a.instance_type.localeCompare(b.instance_type));

    const metaItems = [...latestByInst.entries()]
      .map(([t, e]) => ({ t, p: e.price }))
      .sort((a, b) => a.t.localeCompare(b.t));

    // Rollups are built from the FULL daily history above; only the shipped
    // daily/weekly arrays are trimmed to their display windows.
    return {
      daily: trimByDate(dailyArr, DAILY_KEEP_DAYS),
      weekly: trimByDate(rollup(weeklyMap), WEEKLY_KEEP_DAYS),
      monthly: rollup(monthlyMap),
      ondemand: ondemandArr,
      meta: metaItems,
    };
  }

  return { ingest, finalize };
}

// Keep only records within `keepDays` of the latest date (arrays are date-sorted).
function trimByDate(arr, keepDays) {
  if (arr.length === 0) return arr;
  const max = new Date(arr[arr.length - 1].date + 'T00:00:00Z');
  max.setUTCDate(max.getUTCDate() - keepDays);
  const cutoff = max.toISOString().slice(0, 10);
  return arr.filter(d => d.date >= cutoff);
}

// Collapse a per-day on-demand series to change-points, anchoring the last
// record per instance so the line still extends to the latest date.
function dedupeOndemand(arr) {
  const byInst = new Map();
  for (const r of arr) {
    if (!byInst.has(r.instance_type)) byInst.set(r.instance_type, []);
    byInst.get(r.instance_type).push(r);
  }
  const out = [];
  for (const rows of byInst.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let prev = null;
    rows.forEach((r, i) => {
      if (prev === null || r.price !== prev || i === rows.length - 1) out.push(r);
      prev = r.price;
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Main collection ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function daysBetween(start, end) {
  return Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000);
}

function splitDate(start, end) {
  const m = new Date(start + 'T00:00:00Z');
  m.setUTCDate(m.getUTCDate() + Math.floor(daysBetween(start, end) / 2));
  return m.toISOString().slice(0, 10);
}

// Fetch [start, end). If the server caps the result (i.e. it's truncated), the
// partial page is discarded and the range is split in half and re-fetched, so
// busy windows auto-subdivide down to a single day rather than dropping events.
// Returns the number of events actually ingested.
async function fetchRange(provider, region, instTypes, start, end, acc) {
  const results = await queryTITANS(provider, region, instTypes, start, end);
  if (results.length >= CAP && daysBetween(start, end) > 1) {
    const mid = splitDate(start, end);
    process.stdout.write('split ');
    await sleep(350);
    const a = await fetchRange(provider, region, instTypes, start, mid, acc);
    await sleep(350);
    const b = await fetchRange(provider, region, instTypes, mid, end, acc);
    return a + b;
  }
  acc.ingest(results);
  return results.length;
}

async function collectRegion(provider, region, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  const ranges = dateRanges(cfg.startDate, today, cfg.chunkSize);
  const slug = toSlug(region);
  const regionDir = path.join(OUT, provider, slug);

  // Track which ranges we've already processed (for resume)
  const progressFile = path.join(regionDir, '.progress.json');
  const acc = makeAccumulator();
  let processedRanges = new Set();

  // If partial output exists, reload aggregated daily data to resume
  if (fs.existsSync(progressFile)) {
    try {
      const prog = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      processedRanges = new Set(prog.processed || []);
      // Reload daily to re-hydrate the accumulator isn't easy, so we just track
      // processed ranges and re-use whatever we saved last time
      const dailyFile = path.join(regionDir, 'daily.json');
      if (fs.existsSync(dailyFile)) {
        const saved = JSON.parse(fs.readFileSync(dailyFile, 'utf8'));
        for (const d of saved) {
          // Re-inject as single-sample events to restore accumulator state
          for (let i = 0; i < d.samples; i++) acc.ingest([{
            Time: d.date + 'T00:00:00+00:00',
            InstanceType: d.instance_type,
            SpotPrice: d.avg,
            OndemandPrice: 0,
          }]);
        }
        console.log(`  Resuming with ${saved.length} existing daily records, ${processedRanges.size} ranges done`);
      }
    } catch {
      processedRanges = new Set();
    }
  }

  let newEvents = 0;
  for (const range of ranges) {
    const key = `${range.start}:${range.end}`;
    if (processedRanges.has(key)) continue;

    process.stdout.write(`    ${range.start} → ${range.end} ... `);
    try {
      const n = await fetchRange(provider, region, cfg.instanceTypes, range.start, range.end, acc);
      processedRanges.add(key);
      newEvents += n;
      console.log(`${n} events`);
    } catch (err) {
      console.log(`SKIP (${err.message.slice(0, 100)})`);
      processedRanges.add(key);
    }

    // Save progress marker
    fs.mkdirSync(regionDir, { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify({ processed: [...processedRanges] }));

    await sleep(350);
  }

  const { daily, weekly, monthly, ondemand, meta } = acc.finalize();

  if (daily.length === 0) {
    console.log(`  No data for ${region} — skipping`);
    return null;
  }

  fs.mkdirSync(regionDir, { recursive: true });
  fs.writeFileSync(path.join(regionDir, 'daily.json'), JSON.stringify(daily));
  fs.writeFileSync(path.join(regionDir, 'weekly.json'), JSON.stringify(weekly));
  fs.writeFileSync(path.join(regionDir, 'monthly.json'), JSON.stringify(monthly));
  fs.writeFileSync(path.join(regionDir, 'ondemand.json'), JSON.stringify(ondemand));

  console.log(`  ✓ ${slug}: ${daily.length} daily records, ${meta.length} instances, ${newEvents} new events`);
  return { slug, meta };
}

async function collect(provider) {
  const cfg = CONFIG[provider];
  console.log(`\n══ ${provider.toUpperCase()} ══`);
  console.log(`Regions: ${cfg.regions.join(', ')}`);
  console.log(`Instances: ${cfg.instanceTypes === 'all' || cfg.instanceTypes[0] === 'all' ? 'all' : cfg.instanceTypes.length + ' curated'}`);
  console.log(`From: ${cfg.startDate}  Chunk: ${cfg.chunkSize}`);

  const providerDir = path.join(OUT, provider);
  fs.mkdirSync(providerDir, { recursive: true });

  const meta = {};

  for (const region of cfg.regions) {
    console.log(`\n  Region: ${region}`);
    const result = await collectRegion(provider, region, cfg);
    if (result) meta[result.slug] = result.meta;
  }

  fs.writeFileSync(path.join(providerDir, 'meta.json'), JSON.stringify(meta));
  console.log(`\n  Wrote ${provider}/meta.json (${Object.keys(meta).length} regions)`);
}

async function main() {
  const arg = process.argv[2];
  const providers = arg ? [arg] : ['aws', 'gcp', 'azure'];
  for (const p of providers) {
    if (!CONFIG[p]) { console.error(`Unknown provider: ${p}`); process.exit(1); }
    await collect(p);
  }
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
