'use strict';
/**
 * lib/spot-events.cjs
 * Shared machinery for the direct-from-provider spot collectors
 * (collect-aws.cjs, collect-gcp.cjs, collect-azure.cjs) and build-db.cjs.
 *
 * Three concerns live here:
 *
 *   1. RAW EVENT STORE  raw/<provider>/<region>/YYYY-MM.tsv.gz
 *      One line per price-change event: ts \t az \t instance \t product \t price
 *      This is the source of truth. Everything else (daily/weekly/monthly in
 *      public/data, hourly in spot.sqlite) is derived and can be rebuilt.
 *      Files are rewritten whole when a month gains events (dedupe on
 *      ts|az|instance|product), so re-running a collector is idempotent.
 *
 *   2. TIME-WEIGHTED AGGREGATION
 *      Spot events are price CHANGES, not samples: a price holds from its
 *      timestamp until the next event in the same (instance, az) series. A
 *      bucket's avg is therefore weighted by how long each price was in force
 *      (what a buyer actually pays). The final event of a series is carried
 *      forward to `until` (collection time) but never more than `maxCarry`,
 *      so a retired instance does not grow a fabricated flat tail.
 *      This is the same method collect-pauley.cjs uses for inst-pre/, so the
 *      series it produces splice onto that history without a level step.
 *
 *   3. inst/ REBUILD  public/data/<provider>/<region>/inst/<type>.json
 *      Per-(instance, az) daily buckets are collapsed across AZs by median
 *      (max high, min low), merged into the existing per-instance file for the
 *      dates the raw store covers, and weekly/monthly are re-rolled from the
 *      merged daily. Rows the raw store does not reach (TITANS 2024-02 →
 *      2026-08-17, the USC/ISI monthly archive) are left untouched.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.SPOT_DATA_DIR || path.join(ROOT, 'public', 'data');
const RAW = process.env.SPOT_RAW_DIR || path.join(ROOT, 'raw');

const DAY = 86400;
const HOUR = 3600;

const r6 = (n) => +n.toFixed(6);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const isoDay = (s) => new Date(s * 1000).toISOString().slice(0, 10);
const isoHour = (s) => new Date(s * 1000).toISOString().slice(0, 13) + ':00Z';
const monthOf = (iso) => iso.slice(0, 7);

// ── raw store ────────────────────────────────────────────────────────────────

function rawDir(provider, region) { return path.join(RAW, provider, region); }

function listRawMonths(provider, region) {
  const dir = rawDir(provider, region);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.tsv\.gz$/.test(f)).map((f) => f.slice(0, 7)).sort();
}

function readRawMonth(provider, region, month) {
  const file = path.join(rawDir(provider, region), `${month}.tsv.gz`);
  if (!fs.existsSync(file)) return [];
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const p = line.split('\t');
    if (p.length < 5) continue;
    out.push({ ts: p[0], az: p[1], inst: p[2], product: p[3], price: +p[4] });
  }
  return out;
}

/** Read events for a region. `months` = array of 'YYYY-MM' (default: all). */
function readRaw(provider, region, months) {
  const list = months || listRawMonths(provider, region);
  const out = [];
  for (const m of list) for (const e of readRawMonth(provider, region, m)) out.push(e);
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return out;
}

/** Latest event timestamp in the store, or null. */
function lastRawTs(provider, region) {
  const months = listRawMonths(provider, region);
  if (!months.length) return null;
  let max = '';
  for (const e of readRawMonth(provider, region, months[months.length - 1])) if (e.ts > max) max = e.ts;
  return max || null;
}

const eventKey = (e) => `${e.ts}|${e.az}|${e.inst}|${e.product}`;

/**
 * Merge events into the store. Returns { added, months }.
 * Events: { ts (ISO 8601 UTC), az, instance/inst, product, price }.
 */
function appendRaw(provider, region, events) {
  const byMonth = new Map();
  for (const ev of events) {
    const e = { ts: ev.ts, az: ev.az, inst: ev.inst || ev.instance, product: ev.product, price: +ev.price };
    if (!(e.price > 0) || !e.ts || !e.inst) continue;
    const m = monthOf(e.ts);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(e);
  }
  const dir = rawDir(provider, region);
  fs.mkdirSync(dir, { recursive: true });
  let added = 0;
  const months = [];
  for (const [m, incoming] of [...byMonth.entries()].sort()) {
    const existing = readRawMonth(provider, region, m);
    const seen = new Map();
    for (const e of existing) seen.set(eventKey(e), e);
    let n = 0;
    for (const e of incoming) { const k = eventKey(e); if (!seen.has(k)) { seen.set(k, e); n++; } }
    if (n === 0) continue;
    const rows = [...seen.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.inst.localeCompare(b.inst) || a.az.localeCompare(b.az)));
    const text = rows.map((e) => `${e.ts}\t${e.az}\t${e.inst}\t${e.product}\t${e.price}`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, `${m}.tsv.gz`), zlib.gzipSync(Buffer.from(text), { level: 9 }));
    added += n;
    months.push(m);
  }
  return { added, months };
}

// ── time-weighted aggregation ────────────────────────────────────────────────

/**
 * series: [[tSec, price], ...] for ONE (instance, az). Returns buckets sorted
 * by start: { t, open, high, low, close, avg, dur } with dur in seconds.
 */
function weighted(series, { bucket = DAY, until, maxCarry = 10 * DAY }) {
  series.sort((a, b) => a[0] - b[0]);
  const out = new Map();
  for (let i = 0; i < series.length; i++) {
    const [t, price] = series[i];
    const end = i + 1 < series.length ? series[i + 1][0] : Math.min(until, t + maxCarry);
    if (end <= t) continue;
    let cur = t;
    while (cur < end) {
      const bStart = Math.floor(cur / bucket) * bucket;
      const stop = Math.min(end, bStart + bucket);
      let o = out.get(bStart);
      if (!o) out.set(bStart, (o = { t: bStart, sum: 0, dur: 0, high: -Infinity, low: Infinity, open: price, close: price }));
      o.sum += price * (stop - cur);
      o.dur += stop - cur;
      if (price > o.high) o.high = price;
      if (price < o.low) o.low = price;
      o.close = price;
      cur = stop;
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t).map((o) => ({
    t: o.t, open: r6(o.open), high: r6(o.high), low: r6(o.low), close: r6(o.close), avg: r6(o.sum / o.dur), dur: o.dur,
  }));
}

/** Collapse several AZ bucket arrays (same bucket size) into one, keyed by t. */
function collapseAZs(perAz) {
  const by = new Map();
  for (const arr of perAz) {
    for (const b of arr) {
      let e = by.get(b.t);
      if (!by.get(b.t)) by.set(b.t, (e = { t: b.t, open: [], close: [], avg: [], high: -Infinity, low: Infinity, dur: 0 }));
      e.open.push(b.open); e.close.push(b.close); e.avg.push(b.avg);
      if (b.high > e.high) e.high = b.high;
      if (b.low < e.low) e.low = b.low;
      if (b.dur > e.dur) e.dur = b.dur;
    }
  }
  return [...by.values()].sort((a, b) => a.t - b.t).map((e) => ({
    t: e.t, open: r6(median(e.open)), high: r6(e.high), low: r6(e.low), close: r6(median(e.close)), avg: r6(median(e.avg)), dur: e.dur,
  }));
}

/** Group raw events by instance → az → [[t, price]]. */
function seriesByInstance(events) {
  const m = new Map();
  for (const e of events) {
    let azs = m.get(e.inst);
    if (!azs) m.set(e.inst, (azs = new Map()));
    let s = azs.get(e.az);
    if (!s) azs.set(e.az, (s = []));
    s.push([sec(e.ts), e.price]);
  }
  return m;
}

/** instance → daily rows [{date, open, high, low, close, avg}] (AZ-collapsed). */
function dailyByInstance(events, { until, maxCarry }) {
  const out = new Map();
  for (const [inst, azs] of seriesByInstance(events)) {
    const perAz = [...azs.values()].map((s) => weighted(s, { bucket: DAY, until, maxCarry }));
    const rows = collapseAZs(perAz).map(({ t, open, high, low, close, avg }) => ({ date: isoDay(t), open, high, low, close, avg }));
    if (rows.length) out.set(inst, rows);
  }
  return out;
}

/** instance → hourly rows [{hour, open, high, low, close, avg, dur}]. */
function hourlyByInstance(events, { until, maxCarry }) {
  const out = new Map();
  for (const [inst, azs] of seriesByInstance(events)) {
    const perAz = [...azs.values()].map((s) => weighted(s, { bucket: HOUR, until, maxCarry }));
    const rows = collapseAZs(perAz).map(({ t, open, high, low, close, avg, dur }) => ({ hour: isoHour(t), open, high, low, close, avg, dur }));
    if (rows.length) out.set(inst, rows);
  }
  return out;
}

// ── rollups (ISO week Monday, calendar month) ────────────────────────────────

function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const monthStart = (date) => date.slice(0, 7) + '-01';

function rollup(daily, keyOf) {
  const b = new Map();
  for (const d of daily) {
    const k = keyOf(d.date);
    let e = b.get(k);
    if (!e) b.set(k, (e = { date: k, open: d.open, high: -Infinity, low: Infinity, avg: [], close: d.close }));
    if (d.high > e.high) e.high = d.high;
    if (d.low < e.low) e.low = d.low;
    e.avg.push(d.avg);
    e.close = d.close;
  }
  return [...b.values()].sort((x, y) => x.date.localeCompare(y.date))
    .map((e) => ({ date: e.date, open: r6(e.open), high: r6(e.high), low: r6(e.low), close: r6(e.close), avg: r6(median(e.avg)) }));
}

// ── inst/ rebuild ────────────────────────────────────────────────────────────

/**
 * Rebuild public/data/<provider>/<slug>/inst/*.json from the raw store.
 *
 * opts.months     raw months to read (default all). Read at least maxCarry
 *                 before the window you want refreshed.
 * opts.from       'YYYY-MM-DD': only daily rows >= from are replaced; earlier
 *                 rows in the existing files are kept. Default: first day of
 *                 the first month read + maxCarry (so warm-up days from
 *                 carried-in prices are not trusted).
 * opts.until      seconds; default now.
 * opts.maxCarry   seconds a final price may be carried.
 * Returns { instances, rowsWritten, from }.
 */
function rebuildInst(provider, slug, opts = {}) {
  const until = opts.until || Math.floor(Date.now() / 1000);
  const maxCarry = opts.maxCarry || 10 * DAY;
  const months = opts.months || listRawMonths(provider, slug);
  if (!months.length) return { instances: 0, rowsWritten: 0, from: null };
  const events = readRaw(provider, slug, months);
  const from = opts.from || isoDay(sec(months[0] + '-01T00:00:00Z') + maxCarry);

  const regionDir = path.join(DATA, provider, slug);
  const instDir = path.join(regionDir, 'inst');
  fs.mkdirSync(instDir, { recursive: true });

  let rowsWritten = 0;
  const daily = dailyByInstance(events, { until, maxCarry });
  for (const [inst, rows] of daily) {
    const fresh = rows.filter((r) => r.date >= from);
    if (!fresh.length) continue;
    const file = path.join(instDir, `${inst}.json`);
    let existing = { daily: [], weekly: [], monthly: [] };
    if (fs.existsSync(file)) { try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* rebuild from scratch */ } }
    const kept = (existing.daily || []).filter((d) => d.date < from);
    const merged = kept.concat(fresh);
    const first = merged[0].date;
    const weekly = (existing.weekly || []).filter((w) => w.date < weekStart(first)).concat(rollup(merged, weekStart));
    const monthly = (existing.monthly || []).filter((m) => m.date < monthStart(first)).concat(rollup(merged, monthStart));
    fs.writeFileSync(file, JSON.stringify({ daily: merged, weekly, monthly }));
    rowsWritten += fresh.length;
  }
  return { instances: daily.size, rowsWritten, from };
}

/** Regenerate public/data/<provider>/meta.json[slug] from the inst/ dir. */
function updateMeta(provider, slug) {
  const instDir = path.join(DATA, provider, slug, 'inst');
  if (!fs.existsSync(instDir)) return 0;
  const list = [];
  for (const f of fs.readdirSync(instDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(instDir, f), 'utf8'));
      const last = (j.daily && j.daily.length && j.daily[j.daily.length - 1]) || (j.monthly && j.monthly.length && j.monthly[j.monthly.length - 1]);
      if (last) list.push({ t: f.slice(0, -5), p: last.avg });
    } catch { /* skip corrupt */ }
  }
  list.sort((a, b) => a.t.localeCompare(b.t));
  const metaFile = path.join(DATA, provider, 'meta.json');
  let meta = {};
  if (fs.existsSync(metaFile)) { try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { meta = {}; } }
  meta[slug] = list;
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return list.length;
}

// ── misc ─────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retry on 429/5xx/network errors, exponential backoff. */
async function fetchRetry(url, init = {}, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        const ra = +res.headers.get('retry-after');
        await sleep(ra ? ra * 1000 : 800 * 2 ** i);
        lastErr = new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(800 * 2 ** i);
    }
  }
  throw lastErr;
}

/** Run `fn(item)` over items with bounded concurrency; returns results in order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

/** Minimal argv parser: --key value / --flag, positionals. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--')) { out[k] = v; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

module.exports = {
  DATA, RAW, DAY, HOUR, r6, median, sec, isoDay, isoHour,
  listRawMonths, readRawMonth, readRaw, lastRawTs, appendRaw,
  weighted, collapseAZs, seriesByInstance, dailyByInstance, hourlyByInstance,
  weekStart, monthStart, rollup, rebuildInst, updateMeta,
  sleep, fetchRetry, pool, parseArgs,
};
