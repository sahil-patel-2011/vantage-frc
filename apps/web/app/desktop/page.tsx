import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Desktop app — Vantage",
  description:
    "Vantage in a Windows window for FRC teams. Same invite-only sign-in as the website. Windows may warn that the file isn’t signed yet — that is expected.",
  path: "/desktop",
});

const facts = [
  {
    title: "Account required",
    copy: "Sign in the same way as the website — Google or an email code. Your team owner or admin invites your exact email. Everyone else lands on the waitlist.",
  },
  {
    title: "Stays signed in",
    copy: "One sign-in lasts between launches on this computer until the session expires or you sign out. Window size and position come back too.",
  },
  {
    title: "Same Vantage",
    copy: "This is the live product in its own window, not a second copy. Other links open in your browser. vantage-frc:// links open the app.",
  },
  {
    title: "Windows may warn",
    copy: "Download from GitHub Releases. Windows SmartScreen may warn that the publisher is unknown. That is expected until a signing certificate exists — not a virus.",
  },
  {
    title: "Fusion stays on this computer",
    copy: "Fusion jobs still run through the paired CAD app on this machine. Onshape stays in the browser.",
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
            The same Vantage you use in a browser, in its own Windows window. Sign in the same way. Your team
            owner invites your exact email.
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
                Download the Windows app from GitHub Releases. Windows may warn that the publisher is unknown —
                that is expected. Mentors who build from the repo can follow{" "}
                <a href="https://github.com/sahil-patel-2011/vantage-frc/blob/main/docs/DESKTOP.md">the desktop notes</a>.
                Signing a release is optional and not required to run.
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
