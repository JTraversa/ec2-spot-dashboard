import { useState } from 'react';
import ThemeToggle from './ThemeToggle';

const menuLinks = [
  { label: 'Home', href: 'https://traversa.dev' },
  { label: 'About', href: 'https://traversa.dev/about' },
  { label: 'Investments', href: 'https://traversa.dev/investments' },
  { label: 'Photography', href: 'https://traversa.dev/photography' },
  { label: 'Research', href: 'https://traversa.dev/research' },
];

const toolLinks = [
  { label: 'Tools', href: 'https://tools.traversa.dev' },
  { label: 'Aave Liquidation Search', href: 'https://tools.traversa.dev/aave', indent: true },
  { label: 'AWS Spot Price Dashboard', href: '/', indent: true },
  { label: 'Epoch & Block Converter', href: 'https://tools.traversa.dev/epoch', indent: true },
  { label: 'License Generator', href: 'https://tools.traversa.dev/license', indent: true },
  { label: 'RPC Benchmarking', href: 'https://tools.traversa.dev/rpc', indent: true },
];

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
    document.body.classList.toggle('ovhidden');
  };

  return (
    <>
      <header className="site-header">
        <div className="header-left">
          <ThemeToggle />
          <button className="menu-toggle" onClick={toggleMenu}>
            {menuOpen ? (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M15 6H1v1h14V6zm0 3H1v1h14V9z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className={`site-nav${menuOpen ? ' nav-open' : ''}`}>
        <div className="nav-bg">
          <div className="nav-wrapper">
            <div className="nav-container">
              <ul className="nav-menu">
                {menuLinks.map(({ label, href }) => (
                  <li key={href} className="nav-menu-item">
                    <a href={href} onClick={toggleMenu}>{label}</a>
                  </li>
                ))}
                <li className="nav-menu-divider" />
                {toolLinks.map(({ label, href, indent }) => (
                  <li key={label} className={`nav-menu-item${indent ? ' nav-tool-item' : ''}`}>
                    <a href={href} onClick={toggleMenu}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="nav-footer">
            <div className="nav-footer-links">
              <a href="https://github.com/jtraversa">Github</a>
              <a href="https://www.linkedin.com/in/juliant94/">LinkedIn</a>
              <a href="https://twitter.com/TraversaJulian">Twitter</a>
            </div>
          </div>
        </div>
      </div>

      <div className="br-top" />
      <div className="br-bottom" />
      <div className="br-left" />
      <div className="br-right" />
    </>
  );
}
