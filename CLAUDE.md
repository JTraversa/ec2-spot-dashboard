# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> A workspace-level `CLAUDE.md` one directory up describes all the sibling dashboards generically. This file covers what is specific to `ec2-spot-dashboard`.

## Commands

```bash
npm install
npm run dev      # vite dev server — app is served under the /cloud-pricing/ base path (http://localhost:5173/cloud-pricing/)
npm run build    # vite build -> dist/
npm run lint     # eslint .
npm run preview  # serve the built dist/

node collect-spotlake.cjs          # refresh spot daily/weekly/monthly/ondemand/meta for ALL providers
node collect-spotlake.cjs aws      # single provider: aws | gcp | azure
node collect-pricing.cjs           # refresh AWS list-price overlays (s3/lambda/transfer/rds/ebs/ri.json)
```

There is no test suite. There are no `npm run collect`/`collect:pricing` scripts — invoke each collector with `node` directly.

## Architecture

Static-data dashboard: a React 19 SPA that reads pre-built JSON from `public/data/` at runtime. There is **no backend** and the app never calls any upstream API. Refreshing data = run the collector, then redeploy (Vercel).

### `/cloud-pricing/` base path — easy to trip over
`vite.config.js` sets `base: '/cloud-pricing/'`, and `vercel.json` redirects `/` → `/cloud-pricing` and rewrites `/cloud-pricing/*` to the SPA. The old `/aws` and `/aws/*` routes are kept as redirects to `/cloud-pricing` (the project was renamed "AWS Spot" → "Historical Cloud Pricing"; the repo/dir name `ec2-spot-dashboard` is unchanged). All data fetches go through `import.meta.env.BASE_URL + 'data'` (see `useSpotData.js`), so assets and fetch URLs only resolve correctly under that prefix. When adding fetches or links, use `BASE_URL`/relative paths — never hardcode a leading `/data`.

### Data layer: `src/hooks/useSpotData.js`
This single hook is the entire data access layer; `App.jsx` is just a state/orchestration shell around it.
- On mount it loads `aws/`, `gcp/`, `azure/` `meta.json` (the per-region instance lists). Provider/region price data is **lazy-loaded** on demand via `loadRegion(provider, region)` and memoized in a `useRef` cache keyed `provider/region/<dataset>`.
- `getInstanceData` walks a **granularity fallback chain** (`requested → daily → weekly → monthly`) and returns the first non-empty series plus the `actualGranularity` actually used — so the chart may render a coarser granularity than the user picked.
- Each accessor returns `[]`/`{}` on missing data; the UI is built to degrade silently when a dataset is absent.

### Service selection is encoded in the `instance` string
`App.jsx` overloads a single `instance` state value to mean different services via string prefixes, decoded at the top of the component:
- `s3:all` → S3, `lambda:all` → Lambda, `rds:<type>` → RDS, `ebs:all` → EBS, `transfer:all` → Transfer; anything else is an **EC2 spot instance type**.
- These booleans (`isS3`, `isLambda`, …, `isEC2`) drive which `*ChartData` memo runs and which props `Chart` receives. Adding a new service means: add a prefix, a decode boolean, a `getXxx` accessor pair in the hook, a `*ChartData` memo, and wiring into `Sidebar`/`Chart`.

### AWS-only supplemental datasets
Only AWS regions load `ondemand`, `ri`, `s3`, `lambda`, `rds`, `ebs`, `transfer`, and `storage_comparison` JSON (GCP/Azure get spot prices only). On-demand and RI overlays therefore only appear for `provider === 'aws'`.

### Two collectors, two data families
`collect-spotlake.cjs` (SpotLake TITANS API) writes the **spot** data as **one file per instance** — `<region>/inst/<type>.json` = `{daily, weekly, monthly}` full history — plus `ondemand.json` and `meta.json` per region. (The app loads a single instance's ~66KB file on demand; there are no all-instances `daily.json` blobs anymore — that was the pre-2026-06 layout.) `collect-pricing.cjs` (AWS Price List Bulk API) writes the **list-price overlays** — `s3.json`, `lambda.json`, `transfer.json`, `rds.json`, `ebs.json`, `ri.json`. `storage_comparison.json` has **no** collector (hand-entered Azure/GCP storage prices for the S3 cross-cloud lines).

### `collect-pricing.cjs` — list-price overlays (built 2026-06)
- **Source = the AWS Price List Bulk API** (`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json`). Each service exposes a `versionIndexUrl` of historical versions; overlays are **change-points** extracted by walking versions chronologically and emitting a record only when a tracked price changes. The `rds.json` floor (`2015-12-09`) matches `AmazonEC2`'s earliest version — that's how the source was identified.
- **Two modes, because EC2/RDS version files are enormous.** Historical versions are **not** region/SKU-scoped — each is the whole offer file: **AmazonEC2 ≈ 8.6 GB/version × 119 ≈ 1 TB**, AmazonRDS ≈ 492 MB × 115 ≈ 57 GB, vs AmazonS3/Lambda/DataTransfer ≈ 12–59 MB. So:
  - **FULL** (`s3`, `lambda`, `transfer`): walk every version, rebuild the whole change-point history.
  - **INCREMENTAL** (`ri`, `ebs`, `rds`): EC2/RDS can't be brute-forced, so read only the small **region-scoped *current*** file (`/<version>/<region>/index.json`) and append a change-point where today's price differs from the file's last value. This keeps the prior hand-built history and adds current prices + newly-launched instance types.
- **Pre-2015 hand-seeds are preserved.** `s3`/`ebs`/`transfer` go back to `2012` (S3 even to 2006) — older than the API floor. `mergeSeeds` keeps any existing record dated before the first API-derived record, so regenerating never loses them.
- **Extractor gotchas** (in the `extract*` fns): S3/Lambda use the first price tier, but DataTransfer's internet-egress SKU has a **$0 free-allowance tier first** that must be filtered before the 3 paid tiers line up. Lambda maps by the region-independent `group` attribute; Transfer by `transferType` (`AWS Outbound`/`IntraRegion`/`InterRegion Outbound`). RI no-upfront = the `Hrs` dimension; all-upfront amortizes the `Quantity` upfront over `8760×years` (only no-upfront is charted).
- Versioned files are cached under `.pricing-cache/` (gitignored) so re-runs don't re-download gigabytes.
- The hook (`anchorToLatest` in `useSpotData.js`) carries every overlay series' last value forward to the latest spot date, since these change-point series end at the last price *change*. So a flat tail on an overlay line = "last known price carried forward," not fresh data.

Collector details worth knowing:
- It aggregates raw spot events into OHLC+avg daily buckets (running aggregates, so memory is bounded by the number of buckets, not raw event volume), then rolls up to ISO-week and month.
- **The TITANS API silently caps every query at 500,000 events (`CAP`) and truncates the rest.** This is the critical gotcha: a coarse query over *all* instances in a busy AWS region blows past the cap and drops instances mid-range, leaving per-instance gaps that the monthly chart hides (it connects sparse points) but the daily/weekly short-range views expose as empty. The collector defends against this two ways: (1) AWS uses small **4-day** chunks (`chunkSize` as a number = days) that stay well under the cap (~85K events each); (2) `fetchRange` is **recursive** — any window that comes back at/over the cap is discarded and split in half down to a single day, so no events are silently lost. If you change AWS to coarser chunks or add a busier region, keep the cap in mind.
- **AWS data floor is ~early February 2024** — TITANS returns `parquet not found` (HTTP 500) for months before that, regardless of the configured `startDate`. GCP starts 2024-06, Azure 2025-06.
- It is **resumable**: a `.progress.json` per region tracks completed date ranges, and on restart it re-hydrates the accumulator from the existing `inst/*.json` files. To force a clean re-collect, delete the region's `inst/` dir + `.progress.json`.
- **No trimming — per-instance files carry full history.** The old layout shipped one all-instances `daily.json` (>100 MB/region, over GitHub's file limit) and had to trim daily→120d / weekly→400d. Splitting into per-instance files (~66 KB each) removed that constraint, so the chart loads full history and zooms client-side. On-demand is still filtered of TITANS' `-1`/`0` "no price" sentinels, and the same filter applies to spot prices in `ingest` (`if (!(p > 0)) continue`).
- **⚠️ The 2014–2023 history is a separate archive — do NOT lose it on re-collect.** TITANS only serves ~2024+. The deep *monthly* history (back to **2014-02**, for ~51 legacy instances like c3/m4/m5) comes from the **USC/ISI EC2 Spot Price Archive** and lives in committed `<region>/monthly-archive.json` seed files. `collectRegion` merges these into each instance's `monthly` array (and re-adds fully-retired instances like `g2.2xlarge` to `meta`). Wiping `inst/` for a clean re-collect is fine **only if the `monthly-archive.json` seeds remain** — they are the *only* copy of 2014–2023. This was lost once (a TITANS re-collect dropped everything before 2024 until it was restored from git `f18cfce`); the seed-merge exists so it can't recur. **Never delete `monthly-archive.json`.**
- Per-provider config (regions, start dates, chunk size, Azure's curated instance list) lives in the `CONFIG` object near the top.

### Charting
`Chart.jsx` uses **lightweight-charts v5** (TradingView). Technical indicators (SMA, Bollinger, gap-fill) are computed in `src/utils/indicators.js`; CSV export is in `src/utils/export.js`.
- **Time range and resolution (D/W/M) are independent controls** (`Controls.jsx`). The app loads an instance's full series once and the time-range buttons **zoom client-side via `setVisibleRange()`** — they do not swap or re-fetch data.
