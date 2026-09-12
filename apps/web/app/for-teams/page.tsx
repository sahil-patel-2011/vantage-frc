import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_SEASON, MARKETING_STUDENT_PATH } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "For FRC teams — Vantage",
  description:
    "How mentors, drive team, scouts, and business leads share one invite-only FRC app: scouting, CAD from a link, match video, and team ops.",
  path: "/for-teams",
});

const roles = [
  {
    title: "Mentors & coaches",
    copy: "Invite exact emails, set budgets, and keep at least one owner or admin. Students never see the keys page.",
  },
  {
    title: "Drive & strategy",
    copy: "Event day, alliance desk, pick list, and strategy cards — empty until your scouts log real matches.",
  },
  {
    title: "Scouts & pit",
    copy: "Offline forms, coverage, pit mesh, match checklist, repair triage, and battery rotation.",
  },
  {
    title: "Build & programming",
    copy: "Paste an Onshape or Fusion link, Code, Bugbot that quotes source, Failure log, inspection, power and wiring.",
  },
  {
    title: "Business leads",
    copy: "Finance, sponsors (when allowed), grants, impact, and media kit — totals from recorded rows only.",
  },
  {
    title: "Every member",
    copy: "Home island is four apps: Home, Compete, Team, Build. Menu and search for the rest. Chat stays inside your team.",
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
            Mentors invite exact emails. Students open Home, then scout, paste a CAD link, watch match video, and
            run the shop — one login, no extra help required.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="text-link" href="/signin">
              Already invited? Sign in
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="day-one-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="day-one-title">What a student opens first.</h2>
              <p>Four jobs. Same sign-in. Mentors invite you in.</p>
            </header>
            <ul className="lux-feature-grid lux-feature-grid-4">
              {MARKETING_STUDENT_PATH.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-pillars" aria-labelledby="roles-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="roles-title">Who opens what.</h2>
              <p>Same team. Different jobs. Access can be limited per hub for scouts and viewers.</p>
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
            <h2>Invite-only. Every feature on every plan.</h2>
            <p>
              Free is scouting and event day with a small hosted AI allowance or the team&rsquo;s own AI. Pro, Pro+,
              and Max add hosted AI. See <a href="/pricing">pricing</a> or walk <a href="/workflow">how it works</a>.
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="text-link" href="/pricing">
              See plans
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
