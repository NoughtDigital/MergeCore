import type { Metadata } from "next";
import Link from "next/link";
import { homepageCopy } from "@/lib/copy";

const c = homepageCopy;

export const metadata: Metadata = {
  title: "404 — Page not found · MergeCore",
  description:
    "The page you were looking for does not exist. Head back to MergeCore and pick up where you left off.",
};

export default function NotFound() {
  return (
    <>
      <header>
        <div className="wrap header-inner">
          <Link className="logo" href="/">
            MergeCore<span>.dev</span>
          </Link>
          <Link className="nav-cta" href="/#setup-heading">
            {c.hero.primaryCta}
          </Link>
        </div>
      </header>

      <main>
        <div className="wrap not-found">
          <p className="hero-badge">Error 404</p>
          <p className="not-found-code" aria-hidden="true">
            404
          </p>
          <h1>This page slipped past review.</h1>
          <p className="hero-sub">
            The link is broken, the page has moved, or it never shipped. Nothing to flag here —
            just head back to somewhere useful.
          </p>
          <div className="hero-actions">
            <Link className="btn-primary" href="/">
              Back to homepage
            </Link>
            <Link className="btn-ghost" href="/#features-heading">
              {c.hero.secondaryCta}
            </Link>
          </div>

          <div className="plugin-panel not-found-panel">
            <code>mergecore.reviewRoute /{"{missing}"} → 404 not-found</code>
            <p>
              If you followed a link from inside MergeCore and expected something here, let us
              know so we can patch it.
            </p>
          </div>
        </div>
      </main>

      <footer>
        <div className="wrap">
          <p>{c.footer.tagline}</p>
          <p className="footer-credit">
            {c.footer.madeBy.prefix}{" "}
            <a
              href={c.footer.madeBy.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {c.footer.madeBy.linkLabel}
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}
