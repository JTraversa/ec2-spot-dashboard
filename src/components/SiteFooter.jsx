import './SiteFooter.css'
import Mark from './Mark'
import RepoLink from './RepoLink'

// The one corpusAI Cloud Pricing footer, used by the charts page and the GPU
// charts page alike.
const ROOT = 'https://cloud.trycorpus.ai'
const LINKS = [
  { label: 'Data license', href: `${ROOT}/license` },
  { label: 'Privacy', href: `${ROOT}/privacy` },
  { label: 'API docs', href: `${ROOT}/docs` },
  { label: 'x402', href: `${ROOT}/x402` },
  { label: 'Methodology', href: `${ROOT}/methodology` },
  { label: 'www.trycorpus.ai', href: 'https://www.trycorpus.ai' },
  { label: 'hello@trycorpus.ai', href: 'mailto:hello@trycorpus.ai' },
]

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-in">
        <div className="site-footer-brand">
          <a className="site-footer-mark" href={`${ROOT}/`}>
            <Mark size={20} />
            <span>corpusAI <em>Cloud Pricing</em></span>
          </a>
          <p>Cloud, GPU and LLM token prices.</p>
        </div>
        <nav className="site-footer-links" aria-label="corpusAI Cloud Pricing links">
          {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
      </div>
      <div className="site-footer-bottom">
        <span>© 2026 corpusAI · Software that outlives its owners.</span>
        <RepoLink />
      </div>
    </footer>
  )
}
