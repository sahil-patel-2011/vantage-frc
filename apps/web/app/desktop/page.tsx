import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Desktop app — Vantage",
  description:
    "Windows desktop shell for the Vantage FRC app. Account required: same invite-only product, native window, persistent sign-in, and local CAD relay.",
  path: "/desktop",
});

const facts = [
  {
    title: "Account required",
    copy: "The desktop app is the hosted app in a native window — it only works signed in. Signed out, it shows a sign-in screen and blocks everything else. Access stays invite-only.",
  },
  {
    title: "Stays signed in",
    copy: "One sign-in (Google or email code) persists between launches until the session expires or you sign out. Window size and position restore too.",
  },
  {
    title: "Same product, locked down",
    copy: "No second database. The window only opens Vantage and its sign-in and billing pages; other links open in your browser. vantage-frc:// links open the app.",
  },
  {
    title: "Windows first, unsigned",
    copy: "Download an unsigned installer from GitHub Releases, or build it from the repo. SmartScreen warns until code-signing certs exist. No auto-update — install newer releases yourself.",
  },
  {
    title: "CAD stays on this computer",
    copy: "Fusion jobs stay on this computer. Onshape connects in the browser. Pair this computer once, then keep working in the same window.",
  },
] as const;

export default function DesktopPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">Desktop</p>
          <h1>Vantage on the desktop.</h1>
          <p>
            A native Windows window around the live app — scouting, CAD, and Bugbot included. Not a separate
            cloud, and not usable without a Vantage account: the app gates itself to the sign-in flow until you are in.
          </p>
          <div className="actions">
            <a className="button primary" href="/signin">
              Sign in on the web
            </a>
            <a className="button secondary" href="https://github.com/sahil-patel-2011/vantage-frc/releases">
              Windows downloads
            </a>
          </div>
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>What you install</h2>
              <p>
                Tagged GitHub Releases publish unsigned Windows installers. SmartScreen may warn until the team
                signs them. Install a newer release when one is posted.
              </p>
            </header>
            <ul className="lux-feature-grid">
              {facts.map((fact) => (
                <li key={fact.title}>
                  <strong>{fact.title}</strong>
                  <span>{fact.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
