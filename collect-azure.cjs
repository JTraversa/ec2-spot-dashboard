#!/usr/bin/env node
/**
 * collect-azure.cjs
 * Azure Spot VM price history from Azure Resource Graph's SpotResources table
 * (type microsoft.compute/skuspotpricehistory/ostype/location), which holds
 * the trailing 90 days of Spot prices per SKU, OS and region. Linux only.
 * Also snapshots the 28-day eviction rate per SKU into
 * public/data/azure/<slug>/eviction.json (the interruption signal the
 * research notes list as missing).
 *
 * Writes raw/azure/<slug>/YYYY-MM.tsv.gz (az column = ARM location) and
 * rebuilds inst/*.json + meta.json. Region slugs and SKU casing follow the
 * existing TITANS-era files (us-east, us-west-2, eu-west; D2s_v5 …).
 *
 * Auth: a service principal with Reader on any subscription (Resource Graph
 * is free; the subscription only scopes the query).
 *   AZURE_TENANT_ID  AZURE_CLIENT_ID  AZURE_CLIENT_SECRET  AZURE_SUBSCRIPTION_ID
 *
 * The exact shape of properties.spotPrices[] is not documented beyond
 * `priceUSD`; the timestamp field name is detected from a small set of
 * candidates and the first raw record is written to raw/azure/.sample.json so
 * it can be checked after the first run.
 *
 * Usage:
 *   node collect-azure.cjs                 # all regions
 *   node collect-azure.cjs us-east         # one region slug
 *   node collect-azure.cjs --rebuild-only
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib/spot-events.cjs');

// slug (existing data dir) → ARM location
const REGIONS = { 'us-east': 'eastus', 'us-west-2': 'westus2', 'eu-west': 'westeurope' };
// Curated SKUs, same list as collect-spotlake.cjs (Standard_ prefix dropped).
const SKUS = [
  'D2s_v5', 'D4s_v5', 'D8s_v5', 'D16s_v5', 'D32s_v5',
  'D2as_v5', 'D4as_v5', 'D8as_v5', 'D16as_v5',
  'D4als_v7', 'D8als_v7', 'D16als_v7',
  'D4as_v6', 'D8as_v6', 'D16as_v6',
  'F2s_v2', 'F4s_v2', 'F8s_v2', 'F16s_v2',
  'F4als_v6', 'F8als_v6', 'F16als_v6',
  'E2s_v5', 'E4s_v5', 'E8s_v5', 'E16s_v5', 'E32s_v5',
  'E4as_v5', 'E8as_v5', 'E16as_v5',
  'L8s_v3', 'L16s_v3', 'L32s_v3',
  'NC4as_T4_v3', 'NC8as_T4_v3', 'NC16as_T4_v3',
];
const MAX_CARRY = 120 * lib.DAY;   // Azure Spot prices move rarely; history holds only changes
const ARG = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01';
const TS_FIELDS = ['timestamp', 'timeStamp', 'effectiveDate', 'effectiveTime', 'date', 'time', 'startTime'];

const canon = new Map(SKUS.map((s) => [s.toLowerCase(), s]));
const skuName = (armName) => canon.get(String(armName).replace(/^standard_/i, '').toLowerCase()) || String(armName).replace(/^Standard_/i, '');

function env(name) { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

async function accessToken() {
  const res = await lib.fetchRetry(`https://login.microsoftonline.com/${env('AZURE_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: env('AZURE_CLIENT_ID'),
      client_secret: env('AZURE_CLIENT_SECRET'), scope: 'https://management.azure.com/.default',
    }),
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

async function argQuery(query, token) {
  const rows = [];
  let skipToken;
  do {
    const body = { subscriptions: [env('AZURE_SUBSCRIPTION_ID')], query, options: { resultFormat: 'objectArray', $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) } };
    const res = await lib.fetchRetry(ARG, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`ARG: HTTP ${res.status} ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    for (const r of j.data || []) rows.push(r);
    skipToken = j.$skipToken;
  } while (skipToken);
  return rows;
}

const quoteList = (a) => a.map((s) => `'${s}'`).join(', ');

function pickTs(entry) {
  for (const f of TS_FIELDS) if (entry[f]) return entry[f];
  return null;
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  const slugs = args._.length ? args._ : Object.keys(REGIONS);
  const untilSec = Math.floor(Date.now() / 1000);
  let failed = 0;
  let token;
  if (!args['rebuild-only']) token = await accessToken();

  for (const slug of slugs) {
    const loc = REGIONS[slug];
    if (!loc) { console.error(`unknown region slug ${slug}`); failed++; continue; }
    console.log(`\n══ azure / ${slug} (${loc}) ══`);
    try {
      if (!args['rebuild-only']) {
        const skuFilter = quoteList(SKUS.map((s) => `standard_${s.toLowerCase()}`));
        const q = `SpotResources
| where type =~ 'microsoft.compute/skuspotpricehistory/ostype/location'
| where properties.osType =~ 'linux'
| where location =~ '${loc}'
| where sku.name in~ (${skuFilter})
| project skuName = tostring(sku.name), location, spotPrices = properties.spotPrices`;
        const rows = await argQuery(q, token);
        console.log(`  ${rows.length} SKU rows`);
        const events = [];
        let sampleWritten = fs.existsSync(path.join(lib.RAW, 'azure', '.sample.json'));
        for (const r of rows) {
          const prices = Array.isArray(r.spotPrices) ? r.spotPrices : [];
          if (!sampleWritten && prices.length) {
            fs.mkdirSync(path.join(lib.RAW, 'azure'), { recursive: true });
            fs.writeFileSync(path.join(lib.RAW, 'azure', '.sample.json'), JSON.stringify(r, null, 2));
            sampleWritten = true;
          }
          for (const e of prices) {
            const ts = pickTs(e);
            const p = +e.priceUSD;
            if (!ts || !(p > 0)) continue;
            events.push({ ts: new Date(ts).toISOString(), az: loc, inst: skuName(r.skuName), product: 'Linux', price: lib.r6(p) });
          }
        }
        if (rows.length && events.length === 0) {
          throw new Error(`spotPrices entries had no recognised timestamp field (tried ${TS_FIELDS.join(', ')}); see raw/azure/.sample.json`);
        }
        const { added, months } = lib.appendRaw('azure', slug, events);
        console.log(`  ${events.length} price points; ${added} new → raw/azure/${slug}/{${months.join(',')}}`);
        if (events.length === 0) { console.error('  ✗ zero events returned — treating as failure'); failed++; continue; }

        // Eviction-rate snapshot (28-day trailing, per SKU).
        try {
          const evq = `SpotResources
| where type =~ 'microsoft.compute/skuspotevictionrate/location'
| where location =~ '${loc}'
| where sku.name in~ (${skuFilter})
| project skuName = tostring(sku.name), evictionRate = tostring(properties.evictionRate)`;
          const ev = await argQuery(evq, token);
          const out = { asOf: new Date().toISOString().slice(0, 10), window: '28d', rates: {} };
          for (const r of ev) out.rates[skuName(r.skuName)] = r.evictionRate;
          const dir = path.join(lib.DATA, 'azure', slug);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'eviction.json'), JSON.stringify(out));
          console.log(`  eviction rates: ${ev.length} SKUs → eviction.json`);
        } catch (e) { console.error(`  (eviction snapshot skipped: ${e.message.slice(0, 120)})`); }
      }
      const res = lib.rebuildInst('azure', slug, { until: untilSec, maxCarry: MAX_CARRY });
      const n = lib.updateMeta('azure', slug);
      console.log(`  ✓ inst/: ${res.instances} instances, ${res.rowsWritten} daily rows replaced from ${res.from}; meta: ${n} SKUs`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${slug}: ${err.message}`);
    }
  }
  if (failed) { console.error(`\n${failed} region(s) failed`); process.exit(2); }
  console.log('\nDone.');
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
