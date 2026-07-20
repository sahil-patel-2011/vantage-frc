import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "For FRC teams — Vantage",
  description:
    "How mentors and student leads run Competition, Team, Business, Build, and AI hubs—from offline scouting to Alliance Selection Desk—in one invite-only workspace.",
  path: "/for-teams",
});

const roles = [
  {
    title: "Mentors & coaches",
    copy: "Invite-only org, budgets, AI keys at /team/ai-keys, audit-friendly exports.",
  },
  {
    title: "Drive & strategy",
    copy: "Competition Strategy, Alliance Selection Desk, Pick clock, sourced Assistant.",
  },
  {
    title: "Scouts & pit",
    copy: "Offline forms, Command / My Day, Match checklist.",
  },
  {
    title: "Business leads",
    copy: "Sponsors, grants, logistics — Business hub and Season Planning on Team.",
  },
] as const;

const season = [
  { title: "Before the event", copy: "Invite members, link TBA, publish scout forms, set the active event." },
  { title: "At the venue", copy: "Offline scouting, Command, and My Day share that event context." },
  { title: "Alliance selection", copy: "Strategy and Alliance Selection Desk use scout + public facts—or stay empty." },
  { title: "After", copy: "Exports, season report, next milestones." },
] as const;

export default function ForTeamsPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>Built for the whole team.</h1>
          <p>
            Mentors provision access. Students open Competition, Team, Business, Build, and AI. Everyone shares one
            event context—no DEMO win rates.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="roles-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="roles-title">Who opens what.</h2>
            </header>
            <ul className="lux-feature-grid lux-feature-grid-4">
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
              <p>Concrete moments on a real team timeline—not a numbered marketing strip.</p>
            </header>
            <ul className="lux-feature-grid lux-feature-grid-4">
              {season.map((item) => (
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
              Free is the starting plan—your keys or credit top-ups. Individual and Team add hosted AI. See{" "}
              <a href="/pricing">pricing</a> or walk the <a href="/workflow">workflow</a>.
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/pricing#credits">
              Buy AI credits
            </a>
            <a className="button secondary" href="/pricing">
              See plans
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
