import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "How it works — Vantage",
  description:
    "How TBA reference, scouting, Strategy, Pick desk, Event Day, and CAD share one org event context.",
  alternates: { canonical: "/workflow" },
};

const stages = [
  ["1", "Reference", "TBA / Statbotics caches with freshness.", "Setup required"],
  ["2", "Observe", "Offline forms + voice notes → attributed facts.", "Available"],
  ["3", "Reconcile", "Conflicts stay visible before models run.", "Available"],
  ["4", "Decide", "Strategy, Pick desk, FRC Assistant—sourced.", "Available"],
  ["5", "Execute", "Event Day boards, CAD briefs, exports.", "Setup required"],
] as const;

export default function WorkflowPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>How it works.</h1>
          <p>
            One event context. Scout facts feed Strategy, Pick desk, Event Day, and Assistant—never replace their
            sources.
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

        <section className="flow-map lux-content" aria-label="Vantage context flow">
          {stages.map(([id, title, detail, status], index) => (
            <article key={id}>
              <div>
                <b>{id}</b>
                {index < stages.length - 1 && <i aria-hidden="true" />}
              </div>
              <section>
                <span className={`status-badge ${status === "Available" ? "available" : "setup"}`}>
                  {status}
                </span>
                <h2>{title}</h2>
                <p>{detail}</p>
              </section>
            </article>
          ))}
        </section>

        <section className="scout-integration workflow-integration" aria-labelledby="workflow-scout-title">
          <div className="lux-content">
            <header>
              <span className="section-id">SCOUTING LOOP</span>
              <h2 id="workflow-scout-title">Capture → sync → decide → present.</h2>
              <p>Same feed across Soft-UI hubs.</p>
            </header>
            <ol className="integration-steps">
              <li>
                <b>01</b>
                <strong>Capture</strong>
                <span>Match/pit scouting offline.</span>
              </li>
              <li>
                <b>02</b>
                <strong>Sync</strong>
                <span>Attributed facts + conflict review.</span>
              </li>
              <li>
                <b>03</b>
                <strong>Decide</strong>
                <span>Strategy, Assistant, Pick desk.</span>
              </li>
              <li>
                <b>04</b>
                <strong>Present</strong>
                <span>Event Day boards and exports.</span>
              </li>
            </ol>
          </div>
        </section>

        <section className="workflow-principles lux-content">
          <article>
            <span className="section-id">PROVENANCE</span>
            <h2>Evidence types stay labeled.</h2>
            <p>Official, scout, prediction, and approval never blur together.</p>
          </article>
          <article>
            <span className="section-id">TENANCY</span>
            <h2>Org-scoped by design.</h2>
            <p>Invite-only membership; RLS on every request.</p>
          </article>
          <article>
            <span className="section-id">HANDOFFS</span>
            <h2>Humans approve risk.</h2>
            <p>CAD briefs and metered AI check budgets first.</p>
          </article>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Ready when you are.</h2>
            <p>
              Explore the <a href="/features">product map</a>, or read how mentors run a season on{" "}
              <a href="/for-teams">For teams</a>.
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
