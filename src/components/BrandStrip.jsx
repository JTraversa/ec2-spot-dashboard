import './BrandStrip.css'

const API_DOCS = 'https://cloud.trycorpus.ai/docs'

// corpusAI brand strip: the mark (ring in the current text colour, green
// core, as on trycorpus.ai), the free-tier precision note, and the link to
// the paid API where the full-precision history lives.
export default function BrandStrip() {
  return (
    <div className="brand-strip">
      <a className="brand-mark" href="https://www.trycorpus.ai" target="_blank" rel="noopener noreferrer" aria-label="corpusAI">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.75" />
          <rect className="core" x="8" y="8" width="8" height="8" />
        </svg>
        <span>corpusAI</span>
      </a>
      <span className="brand-note">
        Free view: daily detail for the last 90 days, weekly for the last year, monthly beyond.
      </span>
      <a className="brand-api" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/gpu.html`}>
        GPU rental prices: H100, H200, B200 and more per GPU-hour across neo-clouds and spot →
      </a>
      <a className="brand-api" href={API_DOCS} target="_blank" rel="noopener noreferrer">
        Full-precision history, per-zone events and hourly bars: the API, from 0.01 USDC per call →
      </a>
    </div>
  )
}
