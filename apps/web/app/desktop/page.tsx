import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { DESKTOP_RELEASE_MISSING, loadPublishedDesktopRelease } from "../../lib/desktop/release";
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
    copy: "When a Windows build is published, SmartScreen may warn that the publisher is unknown. That is expected until a signing certificate exists — not a virus.",
  },
  {
    title: "Fusion stays on this computer",
    copy: "Fusion jobs still run through the paired CAD app on this machine. Onshape stays in the browser.",
  },
] as const;

export default async function DesktopPage() {
  const published = await loadPublishedDesktopRelease();
  const windowsUrl = published.ok ? published.release.downloads.win_nsis : null;
  const version = published.ok ? published.release.version : null;
  const missing = !published.ok && published.body.error === DESKTOP_RELEASE_MISSING;

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
            {windowsUrl ? (
              <a className="button primary" href={windowsUrl}>
                Download for Windows
              </a>
            ) : null}
            <a className={`button ${windowsUrl ? "secondary" : "primary"}`} href="/signin">
              Sign in on the web
            </a>
          </div>
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>What you install</h2>
              <p>
                {windowsUrl && version
                  ? `Windows ${version} is ready to download. Windows may warn that the publisher is unknown — that is expected. `
                  : missing
                    ? "No Windows build is published yet. Sign in on the web until one is. "
                    : "The Windows download could not be checked just now. Sign in on the web and open this page again. "}
                Mentors who build from the repo can follow{" "}
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
