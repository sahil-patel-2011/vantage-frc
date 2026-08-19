import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Desktop app — Vantage",
  description:
    "Windows desktop shell for the Vantage FRC workspace. Same invite-only product, native window, Google sign-in, and local CAD relay.",
  path: "/desktop",
});

const facts = [
  {
    title: "Same product",
    copy: "The window loads the hosted Vantage app. There is no second database and no DEMO workspace.",
  },
  {
    title: "Windows first",
    copy: "Download an unsigned installer from GitHub Releases, or build it from the repo. SmartScreen warns until code-signing certs exist.",
  },
  {
    title: "CAD stays local",
    copy: "Fusion jobs still run through the paired vantage-cad relay on your machine. Onshape stays hosted OAuth.",
  },
] as const;

export default function DesktopPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>Vantage on the desktop.</h1>
          <p>
            A native Windows window around the live workspace — sign-in, scouting, CAD, and Bugbot included. Not a
            separate cloud.
          </p>
          <div className="actions">
            <a className="button primary" href="/signin">
              Sign in on the web
            </a>
            <a className="button secondary" href="https://github.com/sahiljpatel2011-wq/vantage-frc/releases">
              Windows downloads
            </a>
          </div>
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>What you install</h2>
              <p>
                Tagged GitHub Releases (<code>desktop-v*</code>) publish unsigned NSIS and portable exes. From a
                clone: <code>npm run desktop:dist</code> writes <code>apps/desktop/release/</code>. Details in{" "}
                <a href="https://github.com/sahiljpatel2011-wq/vantage-frc/blob/main/docs/DESKTOP.md">docs/DESKTOP.md</a>.
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
