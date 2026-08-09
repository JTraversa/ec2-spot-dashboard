#!/usr/bin/env node
/**
 * collect-pauley.cjs
 * Ingests the raw AWS spot price-change feed (Eric Pauley's archive, Zenodo
 * concept DOI 10.5281/zenodo.14198917) and produces daily OHLC per instance
 * for the regions we track.
 *
 * Why this exists alongside collect-spotlake.cjs:
 *   TITANS only serves ~2024+, and the USC/ISI monthly archive that covers
 *   2014-2023 is not methodologically comparable to it. Measured on the same
 *   instances, the archive's `avg` runs about 2x its own monthly `low` in every
 *   era, and sits at 88% of on-demand for 2023 where TITANS reads 46% for 2024.
 *   That 41-point step lands exactly on the source seam, so the two cannot be
 *   joined into one price series.
 *
 *   This source is raw price-change EVENTS rather than someone else's
 *   aggregate, so the statistic is computed here, once, consistently. It also
 *   carries the product field, which is the leading suspect for the archive's
 *   inflation: RHEL prices run ~23% above Linux/UNIX and Windows higher still,
 *   so averaging across products would inflate a mean substantially.
 *
 * Method:
 *   Spot events are price CHANGES, not periodic samples: a price holds from its
 *   timestamp until the next event for that series. Daily figures are therefore
 *   TIME-WEIGHTED across the interval each price was in force, which is what a
 *   buyer actually pays. A naive mean over events would overweight brief spikes.
 *
 * Usage:
 *   node collect-pauley.cjs 2023            # one year file
 *   node collect-pauley.cjs 2024-01         # one month file
 *   node collect-pauley.cjs 2022 2023       # several
 */

const fs = require('fs');
const path = require('path');
const fzstd = require('fzstd');

const RECORD = '18821638'; // Zenodo version 2026-02, latest as of 2026-08
const OUT = path.join(__dirname, 'public', 'data', 'aws');

// Global AZ id prefix -> region name. The feed uses ids like `use1-az4`.
const REGIONS = { use1: 'us-east-1', euw1: 'eu-west-1', usw2: 'us-west-2' };
const PRODUCT = 'Linux/UNIX'; // the others are separate SKUs, not the same good

const day = (ts) => ts.slice(0, 10);
const secs = (ts) => Date.parse(ts) / 1000;

async function fileUrl(key) {
  const r = await fetch(`https://zenodo.org/api/records/${RECORD}`);
  const j = await r.json();
  const f = (j.files || []).find((x) => x.key === key);
  if (!f) throw new Error(`no such file in record: ${key}`);
  return { url: f.links.self, size: f.size };
}

/** Stream, decompress and filter. Returns events grouped by region|type|az. */
async function fetchEvents(key) {
  const { url, size } = await fileUrl(key);
  process.stdout.write(`  ${key}: ${(size / 1e6).toFixed(0)}MB compressed\n`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const events = new Map(); // "region|type|az" -> [[t, price], ...]
  let tail = '';
  let kept = 0;
  let seen = 0;
  let bytes = 0;
  let lastLog = Date.now();

  const onChunk = (chunk) => {
    tail += Buffer.from(chunk).toString('utf8');
    const lines = tail.split('\n');
    tail = lines.pop(); // partial line carries to the next chunk
    for (const line of lines) {
      if (!line) continue;
      seen++;
      // az \t instanceType \t product \t price \t timestamp
      const p = line.split('\t');
      if (p.length < 5 || p[2] !== PRODUCT) continue;
      const region = REGIONS[p[0].slice(0, p[0].indexOf('-'))];
      if (!region) continue;
      const k = `${region}|${p[1]}|${p[0]}`;
      let arr = events.get(k);
      if (!arr) events.set(k, (arr = []));
      arr.push([secs(p[4]), +p[3]]);
      kept++;
    }
  };

  const dec = new fzstd.Decompress(onChunk);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    dec.push(value, false);
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      process.stdout.write(
        `    ${((100 * bytes) / size).toFixed(0)}%  rows ${(seen / 1e6).toFixed(1)}M  kept ${(kept / 1e3).toFixed(0)}k\n`
      );
    }
  }
  dec.push(new Uint8Array(0), true);
  if (tail) onChunk(new TextEncoder().encode(tail + '\n'));

  process.stdout.write(`    done: ${(seen / 1e6).toFixed(1)}M rows, kept ${kept.toLocaleString()} (${((100 * kept) / seen).toFixed(2)}%)\n`);
  return events;
}

/**
 * Time-weighted daily OHLC.
 *
 * Each event's price is in force until the next event. The interval is split
 * across day boundaries so a price spanning midnight is attributed to both
 * days in proportion. The final event of a series is carried to the end of its
 * own day only, since we cannot know when it was superseded.
 */
function toDaily(series) {
  series.sort((a, b) => a[0] - b[0]);
  const days = new Map();
  const touch = (d) => {
    let o = days.get(d);
    if (!o) days.set(d, (o = { sum: 0, dur: 0, hi: -Infinity, lo: Infinity, open: null, close: null }));
    return o;
  };
  for (let i = 0; i < series.length; i++) {
    const [t, price] = series[i];
    const end = i + 1 < series.length ? series[i + 1][0] : Math.floor(t / 86400) * 86400 + 86400;
    if (end <= t) continue;
    let cur = t;
    while (cur < end) {
      const dayEnd = Math.floor(cur / 86400) * 86400 + 86400;
      const stop = Math.min(end, dayEnd);
      const d = new Date(cur * 1000).toISOString().slice(0, 10);
      const o = touch(d);
      o.sum += price * (stop - cur);
      o.dur += stop - cur;
      if (price > o.hi) o.hi = price;
      if (price < o.lo) o.lo = price;
      if (o.open === null) o.open = price;
      o.close = price;
      cur = stop;
    }
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, o]) => ({
      date,
      open: +o.open.toFixed(6),
      high: +o.hi.toFixed(6),
      low: +o.lo.toFixed(6),
      close: +o.close.toFixed(6),
      avg: +(o.sum / o.dur).toFixed(6),
      hours: +(o.dur / 3600).toFixed(2),
    }));
}

async function run(keys) {
  for (const key of keys) {
    const file = /^\d{4}$/.test(key) ? `${key}.tsv.zst` : `${key}.tsv.zst`;
    console.log(`\n=== ${file} ===`);
    const events = await fetchEvents(file);

    // region -> type -> az -> daily[]
    const byRegion = new Map();
    for (const [k, arr] of events) {
      const [region, type, az] = k.split('|');
      if (!byRegion.has(region)) byRegion.set(region, new Map());
      const types = byRegion.get(region);
      if (!types.has(type)) types.set(type, {});
      types.get(type)[az] = toDaily(arr);
    }

    for (const [region, types] of byRegion) {
      const dir = path.join(OUT, region);
      fs.mkdirSync(dir, { recursive: true });
      const outFile = path.join(dir, `pauley-${key}.json`);
      const obj = {};
      for (const [type, azs] of types) obj[type] = azs;
      fs.writeFileSync(outFile, JSON.stringify(obj));
      const nAz = Object.values(obj).reduce((a, v) => a + Object.keys(v).length, 0);
      console.log(
        `  ${region}: ${types.size} instance types, ${nAz} type-AZ series -> ${path.relative(__dirname, outFile)} (${(fs.statSync(outFile).size / 1e6).toFixed(1)}MB)`
      );
    }
  }
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node collect-pauley.cjs <year|year-month> [...]');
  process.exit(1);
}
run(args).catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
