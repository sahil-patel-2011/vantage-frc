import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_SEASON } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "For FRC teams — Vantage",
  description:
    "How mentors, drive team, scouts, and business leads share one invite-only FRC workspace: Competition, Team, Business, Build, AI, and Media.",
  path: "/for-teams",
});

const roles = [
  {
    title: "Mentors & coaches",
    copy: "Invite exact emails, budgets, AI keys, section access, and audited exports. Always keep at least one owner or admin.",
  },
  {
    title: "Drive & strategy",
    copy: "Event day, alliance desk, pick clock, pairwise ranking, strategy cards, and sourced Assistant — empty until scouted.",
  },
  {
    title: "Scouts & pit",
    copy: "Offline forms, coverage, disagreements, pit mesh, match checklist, repair triage, and battery rotation.",
  },
  {
    title: "Build & programming",
    copy: "CAD briefs with Onshape or Fusion, Code Coach, Bugbot that quotes source, FMEA, inspection, power and wiring.",
  },
  {
    title: "Business leads",
    copy: "Finance, sponsors (when allowed), grants, impact, and media kit — totals from recorded rows only.",
  },
  {
    title: "Every member",
    copy: "Home island is four apps: Home, Compete, Team, Business. Menu and search for the rest. Chat stays org-scoped.",
  },
] as const;

export default function ForTeamsPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">For teams</p>
          <h1>Built for the whole FRC team.</h1>
          <p>
            Mentors provision access. Students open Competition, Team, Business, Build, AI, and Media. Everyone shares
            one event context. There is no DEMO workspace and no invented win rates.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/features">
              See the product
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="roles-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="roles-title">Who opens what.</h2>
              <p>Same org. Different tabs. Access can be limited per hub for scouts and viewers.</p>
            </header>
            <ul className="lux-feature-grid">
              {roles.map((role) => (
                <li key={role.title}>
                  <strong>{role.title}</strong>
                  <span>{role.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-season" aria-labelledby="season-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="season-title">What happens when.</h2>
              <p>Shop, load-in, venue, and alliance selection — the real calendar, not a slogan.</p>
            </header>
            <ul className="lux-feature-grid lux-feature-grid-4">
              {MARKETING_SEASON.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Start free. Buy AI credits anytime.</h2>
            <p>
              Free is scouting and event day with your own keys or platform Groq/OpenRouter when configured. Pro, Pro+,
              and Max add hosted AI. See <a href="/pricing">pricing</a> or walk the <a href="/workflow">workflow</a>.
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/pricing">
              See plans
            </a>
            <a className="button secondary" href="/desktop">
              Desktop app
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
