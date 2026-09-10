import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_SEASON } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "How it works — Vantage",
  description:
    "How FRC teams use Vantage from shop weeks through alliance selection: offline scouting, TBA event day, sourced strategy, CAD, and season ops.",
  path: "/workflow",
});

const stages = [
  {
    id: "1",
    title: "Stand up the team",
    detail:
      "A platform admin provisions the org. Owners invite exact emails. Members finish onboarding (role, crew, optional team number). Incomplete profiles stay on /onboarding.",
  },
  {
    id: "2",
    title: "Connect what you already have",
    detail:
      "Link TBA for this team’s events. Publish scout forms. Optional: Onshape or Fusion, GitHub for Bugbot, Groq/OpenRouter or BYOK for Assistant. Unconfigured connectors stay setup-required — they do not invent data.",
  },
  {
    id: "3",
    title: "Scout at the venue",
    detail:
      "Match and pit forms keep working when Wi-Fi drops. Photos compress before upload. QR handoff and pit mesh move entries between tablets. Sync joins the org when signal returns.",
  },
  {
    id: "4",
    title: "Run event day from one event",
    detail:
      "Command and My Day use TBA match times. Checklists, pit queue, bumper color, and strategy cards share that event. Empty until the cache and your scouts have rows.",
  },
  {
    id: "5",
    title: "Pick from your notes",
    detail:
      "Alliance Selection Desk, pick list, pairwise ranking, and drive-team tags attach scout evidence to public facts. Private Edge stays blank until scout n is real.",
  },
  {
    id: "6",
    title: "Keep the season",
    detail:
      "Calendar, playbook, finance, CAD briefs, Code Coach, and exports stay in the same login after you load out.",
  },
] as const;

export default function WorkflowPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">How it works</p>
          <h1>One team. One event. Then the rest of the season.</h1>
          <p>
            Scouting feeds strategy and event day. CAD, code, money, and the playbook live in the same org — without a
            pile of extra logins.
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

        <section className="flow-map lux-content" aria-label="How Vantage works">
          {stages.map((stage, index) => (
            <article key={stage.id}>
              <div>
                <b>{stage.id}</b>
                {index < stages.length - 1 && <i aria-hidden="true" />}
              </div>
              <section>
                <h2>{stage.title}</h2>
                <p>{stage.detail}</p>
              </section>
            </article>
          ))}
        </section>

        <section className="lux-season" aria-labelledby="season-when-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="season-when-title">When teams actually use it.</h2>
              <p>Shop weeks, load-in, venue, and alliance selection — not a numbered slogan strip.</p>
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
      </main>
      <SiteFooter />
    </div>
  );
}
