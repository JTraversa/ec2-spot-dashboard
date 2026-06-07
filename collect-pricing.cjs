#!/usr/bin/env node
/**
 * collect-pricing.cjs
 * Rebuilds the AWS list-price overlay files (s3/lambda/transfer/rds/ebs/ri.json)
 * from the AWS Price List Bulk API (https://pricing.us-east-1.amazonaws.com).
 *
 * Each service exposes a version index of historical price files; we walk those
 * chronologically and emit a record whenever a tracked price changes (the files
 * are sparse "change-point" series, matching the originals).
 *
 * Two modes per service:
 *   - FULL rebuild (s3, lambda, transfer): walk every version. Files are small
 *     (≤59MB) so the whole history is recoverable from the API.
 *   - INCREMENTAL (ri, ebs, rds): the AmazonEC2/AmazonRDS version files are
 *     huge (EC2 ≈ 8.6GB/version), so a full historical walk is infeasible.
 *     Instead we read only the small region-scoped *current* file and append a
 *     change-point if today's price differs from the existing file's last value.
 *
 * Pre-API-floor records (the hand-seeded 2012–2014 points) are always retained.
 *
 * Usage:
 *   node collect-pricing.cjs                 # all services
 *   node collect-pricing.cjs s3 lambda       # selected services
 */

const fs = require('fs');
const path = require('path');

const B = 'https://pricing.us-east-1.amazonaws.com';
const OUT = path.join(__dirname, 'public', 'data', 'aws');
const REGIONS = ['us-east-1', 'eu-west-1', 'us-west-2'];

// Older offer versions predate the `regionCode` attribute and key off `location`.
const LOC = {
  'us-east-1': 'US East (N. Virginia)',
  'eu-west-1': 'EU (Ireland)',
  'us-west-2': 'US West (Oregon)',
};

// ── HTTP (+ disk cache for immutable versioned files) ────────────────────────
// Version offer files live under a /<14-digit-timestamp>/ path and never change,
// so cache them to avoid re-downloading gigabytes on re-runs. Cache dir is
// gitignored and can be deleted any time.
const CACHE_DIR = path.join(__dirname, '.pricing-cache');
const cacheable = url => /\/\d{14}\//.test(url);
const cachePath = url => path.join(CACHE_DIR, url.replace(/[^a-z0-9]/gi, '_') + '.json');

async function getJSON(url, tries = 4) {
  if (cacheable(url) && fs.existsSync(cachePath(url))) {
    try { return JSON.parse(fs.readFileSync(cachePath(url), 'utf8')); } catch { /* refetch */ }
  }
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (cacheable(url)) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cachePath(url), JSON.stringify(data)); }
      return data;
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── attribute helpers ────────────────────────────────────────────────────────
function inRegion(attr, region, from = false) {
  const rc = from ? attr.fromRegionCode : attr.regionCode;
  const loc = from ? attr.fromLocation : attr.location;
  return rc === region || loc === LOC[region];
}

// OnDemand price tiers for a SKU, sorted by beginRange.
function tiers(offer, sku) {
  const t = offer.terms && offer.terms.OnDemand && offer.terms.OnDemand[sku];
  if (!t) return [];
  const dims = Object.values(t)[0].priceDimensions;
  return Object.values(dims)
    .map(d => ({ begin: +d.beginRange, usd: parseFloat(d.pricePerUnit.USD), unit: d.unit }))
    .sort((a, b) => a.begin - b.begin);
}
const firstTier = (offer, sku) => { const t = tiers(offer, sku); return t.length ? t[0] : null; };

// Most common value (mode) — used where many SKUs share one representative price.
function mode(arr) {
  const c = new Map();
  for (const v of arr) c.set(v, (c.get(v) || 0) + 1);
  let best = null, n = -1;
  for (const [v, k] of c) if (k > n) { n = k; best = v; }
  return best;
}

// ── extractors: offer + region → [{ <keyField>, price, ...extra }] ───────────
const S3_MAP = {
  'Standard': 'Standard',
  'Standard - Infrequent Access': 'Standard-IA',
  'One Zone - Infrequent Access': 'One Zone-IA',
  'Amazon Glacier': 'Glacier',
  'Glacier Deep Archive': 'Glacier Deep Archive',
  'Glacier Instant Retrieval': 'Glacier Instant Retrieval',
  'Intelligent-Tiering Frequent Access': 'Intelligent-Tiering FA',
  'Reduced Redundancy': 'Reduced Redundancy',
};
function extractS3(offer, region) {
  const out = new Map();
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (p.productFamily !== 'Storage' || !inRegion(a, region)) continue;
    const cls = S3_MAP[a.volumeType];
    if (!cls || out.has(cls)) continue;
    const t = firstTier(offer, p.sku);
    if (t && t.usd > 0) out.set(cls, { storage_class: cls, price: t.usd });
  }
  return [...out.values()];
}

const LAMBDA_MAP = {
  'AWS-Lambda-Duration': 'Compute (x86)',
  'AWS-Lambda-Duration-ARM': 'Compute (ARM)',
  'AWS-Lambda-Requests': 'Requests',
  'AWS-Lambda-Duration-Provisioned': 'Provisioned Compute',
  'AWS-Lambda-Provisioned-Concurrency': 'Provisioned Concurrency',
};
function extractLambda(offer, region) {
  const out = new Map();
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (!inRegion(a, region)) continue;
    const cat = LAMBDA_MAP[a.group];
    if (!cat || out.has(cat)) continue;
    const t = firstTier(offer, p.sku);
    if (t && t.usd > 0) out.set(cat, { category: cat, price: t.usd, unit: t.unit });
  }
  return [...out.values()];
}

function extractTransfer(offer, region) {
  const out = [];
  const irPrices = [];
  let internetSku = null, crossAz = null;
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (!inRegion(a, region, true)) continue;
    if (a.transferType === 'AWS Outbound') internetSku = internetSku || p.sku;
    else if (a.transferType === 'IntraRegion' && crossAz === null) { const t = firstTier(offer, p.sku); if (t) crossAz = t.usd; }
    else if (a.transferType === 'InterRegion Outbound') { const t = firstTier(offer, p.sku); if (t) irPrices.push(t.usd); }
  }
  if (internetSku) {
    const labels = ['Internet (0-10 TB)', 'Internet (10-50 TB)', 'Internet (50-150 TB)'];
    // The first tier is the $0 free allowance — skip it so the paid tiers line up.
    const paid = tiers(offer, internetSku).filter(t => t.usd > 0);
    labels.forEach((lab, i) => { if (paid[i]) out.push({ transfer_type: lab, price: paid[i].usd }); });
  }
  if (crossAz !== null) out.push({ transfer_type: 'Cross-AZ', price: crossAz });
  if (irPrices.length) out.push({ transfer_type: 'Cross-Region', price: mode(irPrices) });
  return out;
}

const SERVICES = {
  s3:       { offer: 'AmazonS3',      keyField: 'storage_class', extract: extractS3 },
  lambda:   { offer: 'AWSLambda',     keyField: 'category',      extract: extractLambda },
  transfer: { offer: 'AWSDataTransfer', keyField: 'transfer_type', extract: extractTransfer },
};

// ── incremental extractors (read the small region-scoped *current* file) ──────
// RDS: MySQL/PostgreSQL Single-AZ on-demand hourly. Region file is already
// scoped, so no region filter is needed.
function extractRDS(offer) {
  const out = new Map();
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (p.productFamily !== 'Database Instance') continue;
    if (a.databaseEngine !== 'MySQL' && a.databaseEngine !== 'PostgreSQL') continue;
    if (a.deploymentOption !== 'Single-AZ') continue;
    const k = `${a.instanceType}|${a.databaseEngine}`;
    if (out.has(k)) continue;
    const t = firstTier(offer, p.sku);
    if (t && t.usd > 0) out.set(k, { instance_type: a.instanceType, engine: a.databaseEngine, price: t.usd });
  }
  return [...out.values()];
}

// EBS: per-GB-month storage price per volume type (in the AmazonEC2 offer).
const EBS_TYPES = new Set(['gp3', 'gp2', 'io1', 'io2', 'st1', 'sc1']);
function extractEBS(offer) {
  const out = new Map();
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (p.productFamily !== 'Storage' || !EBS_TYPES.has(a.volumeApiName)) continue;
    if (!/VolumeUsage/.test(a.usagetype || '')) continue;   // storage, not IOPS/throughput
    if (out.has(a.volumeApiName)) continue;
    const t = firstTier(offer, p.sku);
    if (t && t.usd > 0) out.set(a.volumeApiName, { volume_type: a.volumeApiName, price: t.usd });
  }
  return [...out.values()];
}

// RI: standard 1yr/3yr No-Upfront and All-Upfront, as an effective hourly rate.
function extractRI(offer) {
  const out = [];
  const seen = new Set();
  for (const p of Object.values(offer.products)) {
    const a = p.attributes;
    if (p.productFamily !== 'Compute Instance') continue;
    if (a.operatingSystem !== 'Linux' || a.tenancy !== 'Shared') continue;
    if (a.preInstalledSw !== 'NA' || a.capacitystatus !== 'Used') continue;
    const terms = offer.terms.Reserved && offer.terms.Reserved[p.sku];
    if (!terms) continue;
    for (const term of Object.values(terms)) {
      const ta = term.termAttributes;
      if (ta.OfferingClass !== 'standard') continue;
      if (ta.PurchaseOption !== 'No Upfront' && ta.PurchaseOption !== 'All Upfront') continue;
      const years = ta.LeaseContractLength === '3yr' ? 3 : 1;
      let hourly = 0;
      for (const d of Object.values(term.priceDimensions)) {
        const usd = parseFloat(d.pricePerUnit.USD);
        if (d.unit === 'Hrs') hourly += usd;
        else if (d.unit === 'Quantity') hourly += usd / (8760 * years);  // amortize upfront
      }
      if (hourly <= 0) continue;
      const opt = ta.PurchaseOption === 'No Upfront' ? 'no_upfront' : 'all_upfront';
      const ri_type = `ri_${years}y_${opt}_standard`;
      const k = `${a.instanceType}|${ri_type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ instance_type: a.instanceType, ri_type, price: +hourly.toFixed(6) });
    }
  }
  return out;
}

const INCREMENTAL = {
  rds: { offer: 'AmazonRDS', key: r => `${r.instance_type}|${r.engine}`, extract: extractRDS },
  ebs: { offer: 'AmazonEC2', key: r => r.volume_type, extract: extractEBS },
  ri:  { offer: 'AmazonEC2', key: r => `${r.instance_type}|${r.ri_type}`, extract: extractRI },
};

// Read the region-scoped current file once per offer (EC2 serves both ri + ebs),
// then append a change-point wherever today's price differs from the file's last.
async function appendIncremental(names) {
  const idx = await getJSON(`${B}/offers/v1.0/aws/index.json`);
  const byOffer = {};
  for (const n of names) (byOffer[INCREMENTAL[n].offer] = byOffer[INCREMENTAL[n].offer] || []).push(n);

  for (const [offerName, svcNames] of Object.entries(byOffer)) {
    console.log(`\n══ incremental: ${svcNames.join(', ')} (${offerName}) ══`);
    const base = idx.offers[offerName].currentVersionUrl.replace('/index.json', '');
    const regionIdx = await getJSON(`${B}${base}/region_index.json`);
    for (const region of REGIONS) {
      const offer = await getJSON(B + regionIdx.regions[region].currentVersionUrl);
      const date = (offer.publicationDate || new Date().toISOString()).slice(0, 10);
      for (const n of svcNames) {
        const svc = INCREMENTAL[n];
        const file = path.join(OUT, region, `${n}.json`);
        const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        const last = new Map();
        for (const r of existing) last.set(svc.key(r), r.price);
        const adds = [];
        for (const rec of svc.extract(offer, region)) {
          if (last.get(svc.key(rec)) !== rec.price) { adds.push({ date, ...rec }); last.set(svc.key(rec), rec.price); }
        }
        const merged = existing.concat(adds).sort((a, b) => a.date.localeCompare(b.date));
        fs.writeFileSync(file, JSON.stringify(merged));
        console.log(`  ✓ ${region}/${n}: ${existing.length} existing + ${adds.length} appended = ${merged.length}`);
      }
    }
  }
}

// ── full rebuild: walk every version, build change-points, retain seeds ───────
async function rebuildFull(name) {
  const svc = SERVICES[name];
  const offerIdx = await getJSON(`${B}/offers/v1.0/aws/index.json`);
  const vIdx = await getJSON(B + offerIdx.offers[svc.offer].versionIndexUrl);
  const versions = Object.values(vIdx.versions)
    .map(v => ({ url: B + v.offerVersionUrl, begin: v.versionEffectiveBeginDate }))
    .sort((a, b) => a.begin.localeCompare(b.begin));

  console.log(`\n══ ${name} (${svc.offer}) — ${versions.length} versions ══`);

  // region → keyValue → last price ; region → output records
  const last = {}, out = {};
  for (const r of REGIONS) { last[r] = new Map(); out[r] = []; }

  for (let i = 0; i < versions.length; i++) {
    const offer = await getJSON(versions[i].url);
    const date = (offer.publicationDate || versions[i].begin).slice(0, 10);
    let changes = 0;
    for (const region of REGIONS) {
      for (const rec of svc.extract(offer, region)) {
        const key = rec[svc.keyField];
        const prev = last[region].get(key);
        if (prev !== rec.price) {
          out[region].push({ date, ...rec });
          last[region].set(key, rec.price);
          changes++;
        }
      }
    }
    process.stdout.write(`  [${i + 1}/${versions.length}] ${date}: +${changes}\r`);
  }

  for (const region of REGIONS) {
    const file = path.join(OUT, region, `${name}.json`);
    const recs = out[region].sort((a, b) => a.date.localeCompare(b.date) || String(a[svc.keyField]).localeCompare(b[svc.keyField]));
    const merged = mergeSeeds(file, recs);
    fs.writeFileSync(file, JSON.stringify(merged));
    const seeds = merged.length - recs.length;
    console.log(`  ✓ ${region}: ${merged.length} records (${recs.length} from API, ${seeds} pre-API seeds retained) → ${merged[0] ? merged[0].date : '-'}..${merged[merged.length - 1] ? merged[merged.length - 1].date : '-'}`);
  }
}

// Keep any existing record dated before the first API-derived record (the
// hand-seeded 2012–2014 points the API can't reproduce), then append the rebuild.
function mergeSeeds(file, apiRecs) {
  if (apiRecs.length === 0) return apiRecs;
  const firstApi = apiRecs[0].date;
  let seeds = [];
  if (fs.existsSync(file)) {
    try { seeds = JSON.parse(fs.readFileSync(file, 'utf8')).filter(r => r.date < firstApi); } catch { /* ignore */ }
  }
  // apiRecs are already date-sorted; a stable sort keeps each date's order.
  return seeds.concat(apiRecs).sort((a, b) => a.date.localeCompare(b.date));
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const full = args.filter(a => SERVICES[a]);
  const incr = args.filter(a => INCREMENTAL[a]);
  const runFull = args.length ? full : Object.keys(SERVICES);
  const runIncr = args.length ? incr : Object.keys(INCREMENTAL);
  for (const name of runFull) await rebuildFull(name);
  if (runIncr.length) await appendIncremental(runIncr);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
