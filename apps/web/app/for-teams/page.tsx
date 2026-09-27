import type { Metadata } from "next";
import { HeroProductPanel } from "../../components/marketing/app-frames";
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
    copy: "Invite people by email, set spending limits, and choose who can change what. Students never see your AI key.",
  },
  {
    title: "Drive & strategy",
    copy: "Your next match, the alliance selection board, the pick list and match plans, filled in by what your scouts record.",
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
    copy: "Budgets, spending, sponsors, grants and outreach records, with access set by the team.",
  },
  {
    title: "Every member",
    copy: "Start on Home, use personal shortcuts, or open Competition, Team, Build and Business from the menu. Access follows your team role.",
  },
] as const;

export default function ForTeamsPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero has-visual">
          <p className="lux-kicker">For teams</p>
          <h1>Built for the whole FRC team.</h1>
          <p>
            Scouts, builders, programmers and business leads share a workspace. Team owners invite members
            and assign access; each person starts on Home.
          </p>
          <MarketingRouteActions signIn />
          {/* The right half of the first screen was empty on a laptop: show the product there. */}
          <div className="lux-route-hero-visual">
            <HeroProductPanel />
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
            <h2>Free to use. AI is optional.</h2>
            <p>
              Vantage has no subscription charge. Optional AI uses your personal Codex connection or a personal or team
              provider key. External providers set their own prices and limits. Walk through <a href="/workflow">how it works</a>.
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
