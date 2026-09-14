import './BrandStrip.css'

const API_DOCS = 'https://cloud.trycorpus.ai/docs'
const X402 = 'https://cloud.trycorpus.ai/x402'

// corpusAI brand strip: the mark (ring in the current text colour, green
// core, as on trycorpus.ai), the free-tier precision note, and the link to
// the paid API where the full-precision history lives.
export default function BrandStrip() {
  return (
    <div className="brand-strip">
      <span className="brand-note">
        Free view: daily detail for the last 90 days, weekly for the last year, monthly beyond.
      </span>
      <a className="brand-api" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/gpu.html`}>
        GPU rental prices: H100, H200, B200 and more per GPU-hour across neo-clouds and spot →
      </a>
      <a className="brand-api" href={API_DOCS}>
        Full-precision history, per-zone events, GPU index fixings and token prices: the API, from 0.01 USDC per call →
      </a>
      <a className="brand-api" href={X402}>
        Built for agents: pay per request in USDC over x402, no account →
      </a>
    </div>
  )
}
