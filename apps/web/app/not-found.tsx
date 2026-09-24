import { getSessionCookie } from "better-auth/cookies";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { EmptyState, Button } from "../components/ui";

export const metadata: Metadata = {
  title: "Page not found",
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
export default async function NotFound() {
  // A visitor who isn't signed in followed a bad link to the website, not into the app.
  const signedIn = Boolean(getSessionCookie(await headers()));
  const card = (
    <main className="module-page">
      <EmptyState
        soft
        headingLevel={1}
        badge="Not found"
        badgeTone="setup"
        title="This page is not here"
        description={
          signedIn
            ? "The link may be out of date, or the page may need access your account does not have. Everything else is still where you left it."
            : "The link may be out of date or mistyped."
        }
      >
        <div>
          {signedIn ? (
            <>
              <Button as="a" variant="primary" href="/dashboard">
                Go to Home
              </Button>
              <Button as="a" variant="secondary" href="/docs">
                App manual
              </Button>
            </>
          ) : (
            <>
              <Button as="a" variant="primary" href="/">
                Go to the Vantage home page
              </Button>
              <Button as="a" variant="secondary" href="/signin">
                Sign in
              </Button>
            </>
          )}
        </div>
      </EmptyState>
    </main>
  );
  // Signed out, a bad link was a link to the website: show it inside the website.
  if (!signedIn) {
    return (
      <div className="marketing-site marketing-lux">
        <SiteHeader />
        {card}
        <SiteFooter />
      </div>
    );
  }
  return card;
}
