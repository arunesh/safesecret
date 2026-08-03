import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { LockIcon } from "./icons.js";

export function Layout({ children }: { children: ReactNode }) {
  const isHome = useLocation().pathname === "/";

  return (
    <div className="page">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="site-header">
        <div className="container">
          <Link to="/" className="wordmark">
            <LockIcon size={19} />
            SafeSecret
          </Link>
          <Link to="/faq" className="small">
            How it works
          </Link>
        </div>
      </header>

      <main className="site-main" id="main">
        <div className="container">{children}</div>
      </main>

      {isHome && (
        <aside className="assurance">
          <div className="container">
            <LockIcon size={20} />
            <p>
              <strong>End-to-end encrypted.</strong> Your secret is encrypted in your browser before it&rsquo;s sent.
              We store only ciphertext we can&rsquo;t read &mdash; the key lives in the link, never on our servers.
            </p>
          </div>
        </aside>
      )}

      <footer className="site-footer">
        <div className="container">
          <span>SafeSecret</span>
          <nav className="footer-links">
            <Link to="/faq">How it works</Link>
            <a href="https://github.com/arunesh/safesecret">Source</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
