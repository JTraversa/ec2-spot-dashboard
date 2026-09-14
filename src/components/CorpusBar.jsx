import './CorpusBar.css'
import ThemeToggle from './ThemeToggle'

// The corpusAI top bar shared by the charts and the GPU page: the mark, the
// page name, and the family of pages on cloud.trycorpus.ai. Links are
// absolute so the bar reads the same from the legacy /cloud-pricing/ build.
const ROOT = 'https://cloud.trycorpus.ai'
// Same six links in the same order on every page (the API's docs pages render
// the identical bar server-side); the current page is highlighted, not removed.
const LINKS = [
  { label: 'charts', href: `${ROOT}/charts`, key: 'charts' },
  { label: 'gpu prices', href: `${ROOT}/gpu.html`, key: 'gpu' },
  { label: 'api docs', href: `${ROOT}/docs`, key: 'docs' },
  { label: 'x402', href: `${ROOT}/x402`, key: 'x402' },
  { label: 'methodology', href: `${ROOT}/methodology`, key: 'methodology' },
  { label: 'trycorpus.ai', href: 'https://www.trycorpus.ai', key: 'home' },
]

export default function CorpusBar({ current, theme = true }) {
  return (
    <div className="corpus-top">
      <div className="corpus-top-in">
        <a className="corpus-brand" href={`${ROOT}/`}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.75" />
            <rect className="core" x="8" y="8" width="8" height="8" />
          </svg>
          corpusAI
        </a>
        <nav className="corpus-links" aria-label="corpusAI pages">
          {LINKS.map((l) => <a key={l.key} href={l.href} className={l.key === current ? 'active' : undefined} aria-current={l.key === current ? 'page' : undefined}>{l.label}</a>)}
        </nav>
        {theme && <ThemeToggle />}
      </div>
    </div>
  )
}
