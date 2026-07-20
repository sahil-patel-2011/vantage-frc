import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "For teams — Vantage",
  description:
    "How FRC mentors and student leads run scouting, Event Day, alliance selection, season planning, and team ops in Vantage.",
  alternates: { canonical: "/for-teams" },
};

const roles = [
  {
    title: "Mentors & coaches",
    copy: "Invite-only org, budgets, AI keys, and audit-friendly exports.",
  },
  {
    title: "Drive & strategy",
    copy: "Alliance Selection Desk, Pick clock, and sourced Assistant answers.",
  },
  {
    title: "Scouts & pit",
    copy: "Offline forms, Event Day Command / My Day, match checklist.",
  },
  {
    title: "Business leads",
    copy: "Sponsors, grants, logistics, and season planning in one place.",
  },
] as const;

const season = [
  { title: "Preseason", copy: "Goals, forms, TBA link, AI keys or hosted plan." },
  { title: "Build season", copy: "CAD briefs, Code Coach, knowledge, logistics." },
  { title: "Event weekend", copy: "Scouting sync, Command board, pick desk." },
  { title: "After", copy: "Exports, season report, next milestones." },
] as const;

export default function ForTeamsPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Built for the whole team.</h1>
          <p>
            Mentors provision access. Students open Soft-UI hubs. Everyone shares one event context—no DEMO win rates.
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
              <h2 id="season-title">A calm season rhythm.</h2>
              <p>Same product from kickoff through alliance selection.</p>
            </header>
            <ol className="lux-season-steps lux-season-steps-4">
              {season.map((item, index) => (
                <li key={item.title}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Start free. Add hosted AI when ready.</h2>
            <p>
              Free includes the competition core with your own keys. Paid plans add managed AI as a service—see{" "}
              <a href="/pricing">pricing</a>. Or walk the <a href="/workflow">workflow</a>.
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/features">
              Product map
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
