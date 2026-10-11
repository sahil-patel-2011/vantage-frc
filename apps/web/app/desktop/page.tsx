import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { DesktopDownloads } from "./desktop-downloads";
import { DESKTOP_RELEASE_MISSING, loadPublishedDesktopRelease } from "../../lib/desktop/release";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Desktop app — Vantage",
  description:
    "Vantage for Windows and Mac, for FRC teams. Same invite-only sign-in as the website. Download, open, sign in.",
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
    copy: "Until the Windows installer is signed, SmartScreen may say the publisher is unknown. Choose More info, then Run anyway. That is expected until a signing certificate exists — not a virus.",
  },
  {
    title: "Mac",
    copy: "Open the download and drag Vantage to Applications. Mac builds are signed and checked by Apple before they are published here.",
  },
  {
    title: "Fusion stays on this computer",
    copy: "Fusion jobs still run through the paired CAD app on this machine. Onshape stays in the browser.",
  },
] as const;

export default async function DesktopPage() {
  const published = await loadPublishedDesktopRelease();
  const windowsUrl = published.ok ? published.release.downloads.win_nsis : null;
  // Only a notarized Mac build is ever published (docs/DESKTOP.md), so a listed DMG opens normally.
  const macUrl = published.ok ? published.release.downloads.mac_dmg : null;
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
            The same Vantage you use in a browser, in its own window on Windows or Mac. Sign in the same way.
            Your team owner invites your exact email.
          </p>
          <DesktopDownloads windowsUrl={windowsUrl} macUrl={macUrl} />
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>What you install</h2>
              <p>
                {windowsUrl && version
                  ? `Version ${version} is ready for Windows${macUrl ? " and Mac" : ""}. ${macUrl ? "" : "The Mac version is on its way; use the website on a Mac until then. "}`
                  : missing
                    ? "No Windows build is published yet. Use the website until one is. "
                    : "The Windows download could not be checked just now. Use the website and open this page again. "}
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
