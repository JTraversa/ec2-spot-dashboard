# corpusAI Cloud Pricing: charts

The free, interactive charts of [corpusAI Cloud Pricing](https://cloud.trycorpus.ai/), served at
[cloud.trycorpus.ai/charts](https://cloud.trycorpus.ai/charts) and
[cloud.trycorpus.ai/gpu.html](https://cloud.trycorpus.ai/gpu.html).

A React and Vite single-page app with no backend: it reads static JSON from `public/data/`, which a
daily job refreshes, and draws it with [lightweight-charts](https://github.com/tradingview/lightweight-charts).

## What it shows

- **Spot prices** for AWS EC2 (Linux/UNIX), Google Cloud Spot VMs and Azure Spot VMs, per instance
  type and region. AWS history reaches back to 2014.
- **AWS list prices** beside spot: on-demand and 1-year and 3-year reserved instances, plus S3,
  EBS, Lambda, RDS and data transfer price histories.
- **GPU rental prices** (`gpu.html`): the daily median USD per GPU-hour per provider across
  neo-clouds, marketplaces and hyperscaler spot, with today's cheapest quotes.
- Moving averages, Bollinger bands, and CSV or JSON export of the series on screen.

## Data tiers

The data in this repo is the public tier. Every row is one average price per period: daily
averages for the last 90 days, weekly averages for the last year, and monthly averages before that.
No intraday values, per-zone series or raw price-change events are published here.

Full precision (every price-change event with its zone and timestamp, hourly bars, complete daily
history, GPU index fixings, capacity stress and LLM token prices) is available from the
corpusAI Cloud Pricing API. No account needed: pay per call over x402 or MPP, or use a prepaid key.
See the [API docs](https://cloud.trycorpus.ai/docs) and the
[methodology](https://cloud.trycorpus.ai/methodology).

Sources and their date ranges are cited on the charts page. The data is covered by the
[corpusAI data license](https://cloud.trycorpus.ai/license).

## Run it

Requires Node.js 20.19+ or 22.12+ (what Vite 8 supports).

```bash
npm install
npm run dev       # dev server at http://localhost:5173/cloud-pricing/
npm run build     # production build into dist/
npm run preview   # serve the build
npm run lint
```

The default base path is `/cloud-pricing/`. cloud.trycorpus.ai builds at the root with
`BASE_PATH=/ npm run build`.

## License

The code is released under the [Business Source License 1.1](LICENSE). The data in
`public/data/` is covered by the [corpusAI data license](https://cloud.trycorpus.ai/license).

Questions: [hello@trycorpus.ai](mailto:hello@trycorpus.ai).
