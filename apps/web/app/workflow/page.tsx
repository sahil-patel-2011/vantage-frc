import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "System workflow — Vantage",
  description:
    "How Vantage carries event context, provenance, and scouting into the FRC Assistant, strategy, prediction, pick lists, CAD, and code.",
  alternates: { canonical: "/workflow" },
};

const stages = [
  [
    "1",
    "Reference",
    "Official schedules and metrics enter shared caches with source and freshness state.",
    "Setup required",
  ],
  [
    "2",
    "Observe",
    "Custom match/pit forms and opt-in voice notes capture attributed records that continue offline—then sync into team facts.",
    "Available",
  ],
  [
    "3",
    "Reconcile",
    "Conflicts, confidence, and source differences stay visible for review before anything feeds a model or Assistant reply.",
    "Available",
  ],
  [
    "4",
    "Decide",
    "FRC Assistant, Soft-UI strategy/pick tools, and prediction outputs record their input versions. Pick lists and playbooks stay event-scoped.",
    "Available",
  ],
  [
    "5",
    "Execute",
    "Approved intent moves into display, CAD, Assistant threads, and export workflows under team policy. CAD connectors need OAuth or a local relay.",
    "Setup required",
  ],
];

export default function WorkflowPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Shared context is the handoff layer.</h1>
          <p>
            Global reference data stays separate from private team observations, then joins only inside an authorized
            organization and active event. Synced scout facts inform the Assistant, predictions, playbooks, and pick
            lists—generated output never silently replaces its source evidence.
          </p>
        </header>

        <section className="flow-map" aria-label="Vantage context and provenance flow">
          {stages.map(([id, title, detail, status], index) => (
            <article key={id}>
              <div>
                <b>{id}</b>
                {index < stages.length - 1 && <i aria-hidden="true" />}
              </div>
              <section>
                <span className={`status-badge ${status === "Available" ? "available" : "setup"}`}>{status}</span>
                <h2>{title}</h2>
                <p>{detail}</p>
              </section>
            </article>
          ))}
        </section>

        <section className="scout-integration workflow-integration" aria-labelledby="workflow-scout-title">
          <header>
            <span className="section-id">INTEGRATED SCOUTING</span>
            <h2 id="workflow-scout-title">How scout data moves through the loop.</h2>
            <p>
              One connected system—not five tabs. Offline forms → attributed facts → weighted predictions and Assistant
              context → pick lists and playbooks → pit/TV boards that share the same event.
            </p>
          </header>
          <ol className="integration-steps">
            <li>
              <b>01</b>
              <strong>Capture</strong>
              <span>Match and pit scouting with attribution, even without venue Wi-Fi.</span>
            </li>
            <li>
              <b>02</b>
              <strong>Sync</strong>
              <span>Observations become organization-scoped facts with conflict review.</span>
            </li>
            <li>
              <b>03</b>
              <strong>Inform</strong>
              <span>Strategy, FRC Assistant, predictions, and pick lists read the same feed.</span>
            </li>
            <li>
              <b>04</b>
              <strong>Present</strong>
              <span>Live boards and exports carry the event—not a siloed chat log.</span>
            </li>
          </ol>
        </section>

        <section className="workflow-principles">
          <article>
            <span className="section-id">PROVENANCE</span>
            <h2>Different evidence types stay different.</h2>
            <p>
              Official metrics, scout observations, research findings, predictions, recommendations, and human approvals
              use separate records and labels. That prevents a generated claim from appearing to be an official result.
            </p>
          </article>
          <article>
            <span className="section-id">TENANCY</span>
            <h2>Organization context is deliberate.</h2>
            <p>
              Protected routes require a verified session and organization membership. Row-level context is set per
              transaction so pooled database connections do not carry identity between requests.
            </p>
          </article>
          <article>
            <span className="section-id">HANDOFFS</span>
            <h2>Risky actions require confirmation.</h2>
            <p>
              CAD begins with a confirmed brief; connector-backed actions report setup state; billing and provider
              budgets are checked before managed Assistant or model calls.
            </p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
