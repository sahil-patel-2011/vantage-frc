import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_SEASON } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "How it works — Vantage",
  description:
    "How FRC teams use Vantage from shop weeks through alliance selection: offline scouting, event day, sourced strategy, CAD, and season ops.",
  path: "/workflow",
});

const stages = [
  {
    id: "1",
    title: "Set up your team",
    detail:
      "New team? Join the waitlist: we set your team up and make you its owner, then you invite your students and mentors by email. Joining a team already on Vantage? Its owner or a mentor invites you. Either way you finish a short setup (role, crew) and land on Home.",
  },
  {
    id: "2",
    title: "Connect what you already have",
    detail:
      "Pick your events and publish your scouting forms. Optional: Onshape or Fusion, GitHub, and your own AI keys. Anything not set up yet shows a card with the next step.",
  },
  {
    id: "3",
    title: "Scout at the venue",
    detail:
      "Match and pit forms keep working when Wi-Fi drops. Photos compress before upload. Tablets pass entries to each other by QR code, no Wi-Fi needed. Everything syncs when signal returns.",
  },
  {
    id: "4",
    title: "Run event day from one event",
    detail:
      "Event day shows your next match, its time and your bumper colour. Checklists, the pit queue and strategy cards all follow the same event, and fill in as your scouts record matches.",
  },
  {
    id: "5",
    title: "Pick from your notes",
    detail:
      "Alliance Selection Desk, pick list, pairwise ranking, and drive-team tags attach scout evidence to public facts. Your team’s scouting numbers stay blank until someone actually scouts.",
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
            Scouting feeds strategy and event day. CAD, code, money, and the playbook live in the same place — without a
            pile of extra logins.
          </p>
          <MarketingRouteActions
            companion={{ href: "/features", label: "All features", variant: "secondary" }}
          />
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
              <p>Shop weeks, load-in, the venue, and alliance selection.</p>
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
