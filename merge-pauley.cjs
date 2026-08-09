#!/usr/bin/env node
/**
 * merge-pauley.cjs
 * Emits the history that PREDATES the existing TITANS series, compactly, for
 * the dashboard to prepend at render time.
 *
 *   node merge-pauley.cjs [region ...]      # default: all three
 *
 * Output: public/data/aws/<region>/inst-pre/<type>.json
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY THE PREFIX, AND WHY A COMPACT ENCODING
 *
 * An earlier revision wrote whole merged series to inst-merged/ and came to
 * 460MB, of which ~285MB duplicated inst/ verbatim: only 611 of 1,526 records
 * per instance were new. The dashboard already prepends older points to a dense
 * series at render time (see getInstanceData / denseFrom), so storing the
 * prefix alone reuses machinery that exists and drops the duplication.
 *
 * The verbose record format cost a further 112 bytes each:
 *
 *   {"date":"2022-05-31","open":0.0377,"high":0.0377,"low":0.0377,
 *    "close":0.0377,"avg":0.0377,"src":"pauley"}
 *
 * Spot frequently does not move within a day: 59% of records have OHLC all
 * identical, so the same number was stored five times. `src` was repeated on
 * every row although it changes twice in an entire series.
 *
 * Encoding here, lossless:
 *
 *   [date, v]                        OHLC and avg all equal v
 *   [date, avg, open, high, low, close]   otherwise
 *
 * and `src` is hoisted to file-level date ranges. ~33 bytes/record against 112.
 *
 * ---------------------------------------------------------------------------
 * SOURCES AND THEIR STANDING
 *
 *   pauley           2022-05 -> 2024-01. Raw AWS price-change events, time
 *                    weighted here, Linux/UNIX only. MEASURED.
 *   uscisi-adjusted  2017-01 -> 2022-04. USC/ISI monthly divided by a
 *                    per-instance factor from the 19-month overlap. ESTIMATED.
 *
 * The archive's `avg` is not a time-weighted single-product price. Its
 * inflation is stable within an instance (median CV 13%) but ranges 1.08x to
 * 6.94x between them, and log(factor) against log(price) gives r = -0.931:
 * cheap instances inflate most, the signature of a fixed per-instance cost, so
 * the archive is averaging across the four OS products the raw feed separates.
 * A per-instance factor derived from 2022-2023 and applied blind to earlier
 * years reproduces 32-40% of on-demand against a measured band of 36-46%.
 *
 * Not corrected: anything before 2017 (auction era, distribution differs in
 * kind), instances with < MIN_OVERLAP shared months, or factors with CV above
 * MAX_CV. Those keep no pre-2022 history rather than an untrustworthy one.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'public', 'data', 'aws');
const OUT_DIR = 'inst-pre';
const REGIONS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['us-east-1', 'eu-west-1', 'us-west-2'];

const MIN_OVERLAP = 6;
const MAX_CV = 0.2;
const ADJUST_FROM = '2017-01-01';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const r6 = (n) => +n.toFixed(6);

/** Lossless compact row: 2 elements when flat, 6 when not. */
const pack = (d) =>
  d.open === d.avg && d.high === d.avg && d.low === d.avg && d.close === d.avg
    ? [d.date, d.avg]
    : [d.date, d.avg, d.open, d.high, d.low, d.close];

function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function rollup(daily, keyOf) {
  const b = new Map();
  for (const d of daily) {
    const k = keyOf(d.date);
    let e = b.get(k);
    if (!e) b.set(k, (e = { date: k, open: d.open, hi: -Infinity, lo: Infinity, avg: [], close: d.close }));
    if (d.high > e.hi) e.hi = d.high;
    if (d.low < e.lo) e.lo = d.low;
    e.avg.push(d.avg);
    e.close = d.close;
  }
  return [...b.values()]
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((e) => ({ date: e.date, open: r6(e.open), high: r6(e.hi), low: r6(e.lo), close: r6(e.close), avg: r6(median(e.avg)) }));
}

function collapseAZs(byAz) {
  const days = new Map();
  for (const az of Object.keys(byAz)) {
    for (const d of byAz[az]) {
      let e = days.get(d.date);
      if (!e) days.set(d.date, (e = { open: [], close: [], avg: [], hi: -Infinity, lo: Infinity }));
      e.open.push(d.open); e.close.push(d.close); e.avg.push(d.avg);
      if (d.high > e.hi) e.hi = d.high;
      if (d.low < e.lo) e.lo = d.low;
    }
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({
      date, open: r6(median(e.open)), high: r6(e.hi), low: r6(e.lo),
      close: r6(median(e.close)), avg: r6(median(e.avg)),
    }));
}

for (const region of REGIONS) {
  const base = path.join(DATA, region);
  const instDir = path.join(base, 'inst');
  if (!fs.existsSync(base)) { console.error(`skip ${region}`); continue; }

  const pauley = new Map();
  for (const f of fs.readdirSync(base).filter((x) => /^pauley-.+\.json$/.test(x)).sort()) {
    const obj = JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
    for (const type of Object.keys(obj)) {
      let acc = pauley.get(type);
      if (!acc) pauley.set(type, (acc = {}));
      for (const az of Object.keys(obj[type])) acc[az] = (acc[az] || []).concat(obj[type][az]);
    }
  }

  const outDir = path.join(base, OUT_DIR);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0, adjusted = 0, unstable = 0, noFactor = 0, bytes = 0;

  for (const type of pauley.keys()) {
    const instFile = path.join(instDir, `${type}.json`);
    const inst = fs.existsSync(instFile)
      ? JSON.parse(fs.readFileSync(instFile, 'utf8'))
      : { daily: [], monthly: [] };

    // Only what precedes the dense series.
    const firstTitans = inst.daily && inst.daily.length ? inst.daily[0].date : '9999-99-99';
    const pre = collapseAZs(pauley.get(type)).filter((d) => d.date < firstTitans);
    if (!pre.length) continue;

    // Per-instance correction factor from the overlap.
    const pm = new Map();
    for (const d of collapseAZs(pauley.get(type))) {
      const k = d.date.slice(0, 7);
      if (!pm.has(k)) pm.set(k, []);
      pm.get(k).push(d.avg);
    }
    const ratios = [];
    for (const m of inst.monthly || []) {
      const k = m.date.slice(0, 7);
      const p = pm.has(k) ? median(pm.get(k)) : 0;
      if (p > 0 && m.avg > 0) ratios.push(m.avg / p);
    }
    let factor = null;
    if (ratios.length >= MIN_OVERLAP) {
      const mu = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mu) ** 2, 0) / ratios.length);
      if (sd / mu <= MAX_CV) factor = median(ratios); else unstable++;
    } else noFactor++;

    const monthlyDense = rollup(pre, (d) => d.slice(0, 7) + '-01');
    const firstDense = monthlyDense.length ? monthlyDense[0].date : '9999-99';
    let older = [];
    if (factor) {
      older = (inst.monthly || [])
        .filter((m) => m.date >= ADJUST_FROM && m.date < firstDense && m.avg > 0)
        .map((m) => ({
          date: m.date, open: r6(m.open / factor), high: r6(m.high / factor),
          low: r6(m.low / factor), close: r6(m.close / factor), avg: r6(m.avg / factor),
        }));
      if (older.length) adjusted++;
    }

    const src = { pauley: [pre[0].date, pre[pre.length - 1].date] };
    if (older.length) src['uscisi-adjusted'] = [older[0].date, older[older.length - 1].date, +factor.toFixed(3)];

    const out = {
      src,
      daily: pre.map(pack),
      weekly: rollup(pre, weekStart).map(pack),
      monthly: older.concat(monthlyDense).map(pack),
    };
    const json = JSON.stringify(out);
    fs.writeFileSync(path.join(outDir, `${type}.json`), json);
    bytes += json.length;
    written++;
  }

  console.log(
    `${region}: ${written} instances -> ${OUT_DIR}/  (${(bytes / 1e6).toFixed(1)}MB)\n` +
      `  ${adjusted} with adjusted pre-2022 history; excluded ${unstable} unstable, ${noFactor} insufficient overlap`
  );
}
