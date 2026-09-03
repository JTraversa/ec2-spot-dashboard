#!/usr/bin/env node
/**
 * collect-aws.cjs
 * AWS spot price history straight from EC2 (DescribeSpotPriceHistory), which
 * serves the trailing 90 days of price-change events per instance type, AZ
 * and product. Linux/UNIX only, matching inst-pre/ (Pauley) and TITANS.
 *
 * Writes raw events to raw/aws/<region>/YYYY-MM.tsv.gz and rebuilds the
 * dashboard's inst/*.json + meta.json for the covered window.
 *
 * Auth: the standard AWS credential chain (env AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY, a profile, or an OIDC role in Actions). Read-only;
 * ec2:DescribeSpotPriceHistory is the only permission needed. Free.
 *
 * Usage:
 *   node collect-aws.cjs                       # all configured regions, incremental
 *   node collect-aws.cjs us-east-1             # one region
 *   node collect-aws.cjs --since 2026-06-05    # explicit start (max 90 days back)
 *   node collect-aws.cjs --rebuild-only        # no API calls; rebuild inst/ from raw/
 */

const { EC2Client, paginateDescribeSpotPriceHistory } = require('@aws-sdk/client-ec2');
const lib = require('./lib/spot-events.cjs');

const REGIONS = ['us-east-1', 'eu-west-1', 'us-west-2'];
const PRODUCT = 'Linux/UNIX';
const MAX_BACK_DAYS = 89;          // API allows 90; leave slack for clock skew
const OVERLAP_HOURS = 6;           // re-fetch a little before the last stored event
const MAX_CARRY = 10 * lib.DAY;    // weekly cadence + slack; longer = fabricated tails for retired types
const REBUILD_MONTHS = 5;          // months of raw to read when rebuilding (≥ 90d + carry)

async function fetchRegion(region, since, until) {
  const client = new EC2Client({ region });
  const paginator = paginateDescribeSpotPriceHistory(
    { client, pageSize: 1000 },
    { StartTime: since, EndTime: until, ProductDescriptions: [PRODUCT] },
  );
  const events = [];
  let pages = 0;
  for await (const page of paginator) {
    pages++;
    for (const r of page.SpotPriceHistory || []) {
      if (!r.Timestamp || !r.InstanceType) continue;
      events.push({
        ts: new Date(r.Timestamp).toISOString(),
        az: r.AvailabilityZoneId || r.AvailabilityZone,
        inst: r.InstanceType,
        product: r.ProductDescription || PRODUCT,
        price: +r.SpotPrice,
      });
    }
    if (pages % 50 === 0) process.stdout.write(`    ${pages} pages, ${events.length.toLocaleString()} events\n`);
  }
  return { events, pages };
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  const regions = args._.length ? args._ : REGIONS;
  const now = new Date();
  const untilSec = Math.floor(now.getTime() / 1000);
  let failed = 0;

  for (const region of regions) {
    console.log(`\n══ aws / ${region} ══`);
    try {
      if (!args['rebuild-only']) {
        const floor = new Date(now.getTime() - MAX_BACK_DAYS * 86400e3);
        let since = floor;
        if (args.since) since = new Date(args.since + (args.since.length === 10 ? 'T00:00:00Z' : ''));
        else {
          const last = lib.lastRawTs('aws', region);
          if (last) since = new Date(Date.parse(last) - OVERLAP_HOURS * 3600e3);
        }
        if (since < floor) since = floor;
        console.log(`  fetching ${since.toISOString()} → ${now.toISOString()}`);
        const t0 = Date.now();
        const { events, pages } = await fetchRegion(region, since, now);
        const { added, months } = lib.appendRaw('aws', region, events);
        console.log(`  ${events.length.toLocaleString()} events in ${pages} pages (${((Date.now() - t0) / 1000).toFixed(0)}s); ${added.toLocaleString()} new → raw/aws/${region}/{${months.join(',')}}`);
        if (events.length === 0) { console.error(`  ✗ zero events returned — treating as failure`); failed++; continue; }
      }
      const months = lib.listRawMonths('aws', region).slice(-REBUILD_MONTHS);
      const res = lib.rebuildInst('aws', region, { months, until: untilSec, maxCarry: MAX_CARRY });
      const n = lib.updateMeta('aws', region);
      console.log(`  ✓ inst/: ${res.instances} instances, ${res.rowsWritten.toLocaleString()} daily rows replaced from ${res.from}; meta: ${n} types`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${region}: ${err.name || 'Error'}: ${err.message}`);
    }
  }
  if (failed) { console.error(`\n${failed} region(s) failed`); process.exit(2); }
  console.log('\nDone.');
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
