import type { Metadata } from "next";
import { EmptyState } from "../components/ui";

export const metadata: Metadata = {
  title: "Page not found — Vantage",
  robots: { index: false, follow: false },
};

/**
 * The product's 404.
 *
 * Without this file every `notFound()` — the platform-admin gate on /admin, a
 * missing docs slug, a stale bookmark — fell through to Next's built-in
 * "404 | This page could not be found", which carries none of the product's
 * type, colour or chrome and offers no way back. The route still 404s; it just
 * looks like part of the app now.
 */
export default function NotFound() {
  return (
    <main className="module-page">
      <EmptyState
        soft
        badge="Not found"
        badgeTone="setup"
        title="This page is not here"
        description="The link may be out of date, or the page may need access your account does not have. Everything else is still where you left it."
      >
        <div>
          <a className="app-button" href="/dashboard">
            Go to Home
          </a>
          <a className="app-button secondary" href="/docs">
            App manual
          </a>
        </div>
      </EmptyState>
    </main>
  );
}
