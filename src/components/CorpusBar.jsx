import './CorpusBar.css'
import Mark from './Mark'

// The corpusAI Cloud Pricing top bar, shared by the charts page and the GPU
// charts page. Links are absolute so the bar reads the same from any build base.
const ROOT = 'https://cloud.trycorpus.ai'
// Same links in the same order on every page (the API's server-rendered pages
// carry the same bar); the current section is highlighted, not removed.
const LINKS = [
  { label: 'charts', href: `${ROOT}/charts`, key: 'charts' },
  { label: 'gpu_prices', href: `${ROOT}/gpu`, key: 'gpu' },
  { label: 'api_docs', href: `${ROOT}/docs`, key: 'docs' },
  { label: 'x402', href: `${ROOT}/x402`, key: 'x402' },
  { label: 'methodology', href: `${ROOT}/methodology`, key: 'methodology' },
  { label: 'trycorpus.ai', href: 'https://www.trycorpus.ai', key: 'home' },
]

export default function CorpusBar({ current }) {
  return (
    <div className="corpus-top">
      <div className="corpus-top-in">
        <a className="corpus-brand" href={`${ROOT}/`}>
          <Mark size={22} />
          <span>corpusAI <em>Cloud Pricing</em></span>
        </a>
        <nav className="corpus-links" aria-label="corpusAI Cloud Pricing sections">
          {LINKS.map((l) => (
            <a key={l.key} href={l.href} className={l.key === current ? 'active' : undefined} aria-current={l.key === current ? 'page' : undefined}>{l.label}</a>
          ))}
        </nav>
      </div>
    </div>
  )
}
