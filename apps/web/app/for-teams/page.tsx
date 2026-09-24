import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_SEASON, MARKETING_STUDENT_PATH } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "For FRC teams — Vantage",
  description:
    "How mentors, drive team, scouts, and business leads share one invite-only FRC app: scouting, CAD from a link, team chat, and team ops.",
  path: "/for-teams",
});

const roles = [
  {
    title: "Mentors & coaches",
    copy: "Invite exact emails, set budgets, and keep at least one owner or admin. Students never see API keys.",
  },
  {
    title: "Drive & strategy",
    copy: "Event day, alliance desk, pick list, and strategy cards — empty until your scouts log real matches.",
  },
  {
    title: "Scouts & pit",
    copy: "Forms that work offline, scouting coverage, the match checklist, repair triage and battery rotation.",
  },
  {
    title: "Build & programming",
    copy: "Paste an Onshape or Fusion link, get code help and code review that points to the exact line, plus risk checks, inspection, power and wiring.",
  },
  {
    title: "Business leads",
    copy: "Money, sponsors, grants, outreach and a media kit, with totals only from what your team actually recorded.",
  },
  {
    title: "Every member",
    copy: "Every member starts on Home, Matches, Scout and Stats; the menu and search find the rest. Chat stays inside your team.",
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
            Mentors invite exact emails. Students open Home, then scout, paste a CAD link, talk with the team, and
            run the shop — one login, no extra help required.
          </p>
          <MarketingRouteActions signIn />
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
              <p>Same team. Different jobs. Owners can choose what students and guests can open.</p>
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
              <p>Shop, load-in, the venue, and alliance selection.</p>
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
            <h2>Free for every team. Bring your own AI key.</h2>
            <p>
              Every feature, no plans, no card. AI runs on your team&rsquo;s own key (or a free one), so you see the
              bill and set the limit. Walk through <a href="/workflow">how it works</a>.
            </p>
          </div>
          <MarketingRouteActions
            className="pricing-preview-actions"
            companion={{ href: "/pricing", label: "How AI keys work" }}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
