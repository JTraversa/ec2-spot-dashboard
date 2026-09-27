import './BrandStrip.css'

const API_DOCS = 'https://cloud.trycorpus.ai/docs'
const X402 = 'https://cloud.trycorpus.ai/x402'

// Under the charts title: what the free view holds, and where the rest lives.
export default function BrandStrip() {
  return (
    <div className="brand-strip">
      <span className="brand-note">
        Free view: daily averages for the last 90 days, weekly for the last year, monthly before that.
      </span>
      <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/gpu.html`}>
        GPU rental price charts: H100, H200, B200 and more, per GPU-hour
      </a>
      <a href={API_DOCS}>
        Full-precision history, per-zone events, GPU index fixings and token prices are in the API, from 0.01 USDC per call
      </a>
      <a href={X402}>
        No account needed: pay per call over x402 or MPP, or use a prepaid key.
      </a>
    </div>
  )
}
