#!/usr/bin/env node
/**
 * collect-gcp.cjs
 * GCP Spot VM price history from the Compute Engine Capacity Advisor
 * (regions.advice.capacityHistory, beta), which returns up to ONE YEAR of
 * Spot list-price change intervals per machine type and region. GCP Spot
 * prices are regional (no per-zone price) and move at most daily, in
 * practice roughly monthly, so the event stream is sparse.
 *
 * Writes raw/gcp/<region>/YYYY-MM.tsv.gz (az column = region) and rebuilds
 * inst/*.json + meta.json.
 *
 * Auth: a service account with roles/compute.viewer (needs
 * compute.advice.capacityHistory + compute.machineTypes.list). Provide either
 *   GCP_SA_KEY                       the key JSON as a string, or
 *   GOOGLE_APPLICATION_CREDENTIALS   path to the key file
 * and GCP_PROJECT (defaults to the key's project_id). Free API.
 *
 * Usage:
 *   node collect-gcp.cjs                    # all configured regions
 *   node collect-gcp.cjs us-central1        # one region
 *   node collect-gcp.cjs --types n2-standard-4,e2-medium   # subset (debug)
 *   node collect-gcp.cjs --rebuild-only
 */

const fs = require('fs');
const crypto = require('crypto');
const lib = require('./lib/spot-events.cjs');

const REGIONS = ['us-central1', 'us-east4', 'europe-west4'];
const COMPUTE = 'https://compute.googleapis.com/compute';
const MAX_CARRY = 400 * lib.DAY;   // a Spot price legitimately holds for months
const CONCURRENCY = 6;

// ── auth: service-account JWT → access token (no SDK) ────────────────────────
function loadKey() {
  if (process.env.GCP_SA_KEY) return JSON.parse(process.env.GCP_SA_KEY);
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  throw new Error('no GCP credentials: set GCP_SA_KEY (json) or GOOGLE_APPLICATION_CREDENTIALS (path)');
}

async function accessToken(key) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key, 'base64url');
  const res = await lib.fetchRetry(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function gjson(url, token, init = {}) {
  const res = await lib.fetchRetry(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${text.slice(0, 300)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}

async function machineTypes(project, region, token) {
  const r = await gjson(`${COMPUTE}/v1/projects/${project}/regions/${region}`, token);
  const zones = (r.zones || []).map((z) => z.split('/').pop());
  const names = new Set();
  for (const zone of zones) {
    let pageToken;
    do {
      const u = new URL(`${COMPUTE}/v1/projects/${project}/zones/${zone}/machineTypes`);
      u.searchParams.set('maxResults', '500');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const j = await gjson(u, token);
      for (const m of j.items || []) names.add(m.name);
      pageToken = j.nextPageToken;
    } while (pageToken);
  }
  return [...names].sort();
}

const price = (lp) => (lp ? Number(lp.units || 0) + Number(lp.nanos || 0) / 1e9 : NaN);

async function priceHistory(project, region, type, token) {
  const url = `${COMPUTE}/beta/projects/${project}/regions/${region}/advice/capacityHistory`;
  const body = JSON.stringify({ types: ['PRICE'], instanceProperties: { scheduling: { provisioningModel: 'SPOT' }, machineType: type } });
  const j = await gjson(url, token, { method: 'POST', body });
  const events = [];
  for (const h of j.priceHistory || []) {
    const p = price(h.listPrice);
    const start = h.interval && h.interval.startTime;
    if (!(p > 0) || !start) continue;
    events.push({ ts: new Date(start).toISOString(), az: region, inst: type, product: 'Spot', price: lib.r6(p) });
  }
  return events;
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  const regions = args._.length ? args._ : REGIONS;
  const untilSec = Math.floor(Date.now() / 1000);
  let failed = 0;

  let token, project;
  if (!args['rebuild-only']) {
    const key = loadKey();
    project = process.env.GCP_PROJECT || key.project_id;
    if (!project) throw new Error('GCP_PROJECT not set and key has no project_id');
    token = await accessToken(key);
  }

  for (const region of regions) {
    console.log(`\n══ gcp / ${region} ══`);
    try {
      if (!args['rebuild-only']) {
        const types = args.types ? args.types.split(',') : await machineTypes(project, region, token);
        console.log(`  ${types.length} machine types; fetching price history (${CONCURRENCY} parallel)`);
        let done = 0, errors = 0, sample = null;
        const t0 = Date.now();
        const results = await lib.pool(types, CONCURRENCY, async (type) => {
          try {
            const ev = await priceHistory(project, region, type, token);
            if (!sample && ev.length) sample = ev[0];
            return ev;
          } catch (e) {
            errors++;
            if (errors <= 5) console.error(`    ${type}: ${e.message.slice(0, 160)}`);
            return [];
          } finally {
            if (++done % 100 === 0) process.stdout.write(`    ${done}/${types.length}\n`);
          }
        });
        const events = results.flat();
        const { added, months } = lib.appendRaw('gcp', region, events);
        console.log(`  ${events.length.toLocaleString()} interval events for ${results.filter((r) => r.length).length} types (${errors} errors, ${((Date.now() - t0) / 1000).toFixed(0)}s); ${added} new → raw/gcp/${region}/{${months.join(',')}}`);
        if (sample) console.log(`  sample: ${JSON.stringify(sample)}`);
        if (events.length === 0) { console.error('  ✗ zero events returned — treating as failure'); failed++; continue; }
        if (errors > types.length / 2) { console.error('  ✗ more than half the machine types failed'); failed++; continue; }
      }
      const res = lib.rebuildInst('gcp', region, { until: untilSec, maxCarry: MAX_CARRY });
      const n = lib.updateMeta('gcp', region);
      console.log(`  ✓ inst/: ${res.instances} instances, ${res.rowsWritten.toLocaleString()} daily rows replaced from ${res.from}; meta: ${n} types`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${region}: ${err.message}`);
    }
  }
  if (failed) { console.error(`\n${failed} region(s) failed`); process.exit(2); }
  console.log('\nDone.');
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
