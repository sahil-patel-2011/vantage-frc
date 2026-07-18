import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import {
  AssistantPreview,
  CadPreview,
  CodePreview,
  StrategyPreview,
} from "../../components/marketing/product-demos";

export const metadata: Metadata = {
  title: "Product — Vantage",
  description:
    "Vantage product showcase with honest Available, Shipping, and Setup-required labels: scouting trust, Event Day, kickoff to CAD, logistics, sponsors, grants, orders, knowledge, hubs, and AI.",
  alternates: { canonical: "/features" },
};

type Status = "Available" | "Shipping" | "Setup required";

const surfaces: {
  title: string;
  copy: string;
  status: Status;
}[] = [
  {
    title: "Scouting trust & offline QR",
    copy: "Offline match/pit forms, QR handoffs, disagreement review, coverage gaps, and reliability signals so strategy weighs evidence quality.",
    status: "Available",
  },
  {
    title: "Custom scouting form builder",
    copy: "Versioned match and pit schemas with drivetrain, robot photos, and free-text—published by owners, filled on the Competition hub.",
    status: "Available",
  },
  {
    title: "Scout voice notes",
    copy: "Opt-in voice notes attach to entries without writing form fields. Browser STT is local; cloud STT is metered when configured.",
    status: "Available",
  },
  {
    title: "Event Day + My Day",
    copy: "Shared command for next match and readiness, plus personal shifts, todos, and acknowledgements for what you own today.",
    status: "Available",
  },
  {
    title: "Kickoff → CAD",
    copy: "Season constraints become approval-gated Onshape or Fusion work. Connectors require OAuth or a paired local relay.",
    status: "Setup required",
  },
  {
    title: "Logistics",
    copy: "Travel legs, lodging, packing, and duties beside the competition calendar—not a parallel spreadsheet season.",
    status: "Available",
  },
  {
    title: "Sponsorship, grants & orders",
    copy: "Sponsor pipeline, grant writing assist with honest AI labels, and purchase orders in the Business hub.",
    status: "Available",
  },
  {
    title: "Team knowledge",
    copy: "Org-scoped wiki and season notes the Assistant can read—durable procedures, not a lost Google Doc.",
    status: "Available",
  },
  {
    title: "Product hubs",
    copy: "Competition, Team, Business, Build, and AI hubs group the season so navigation matches how teams work.",
    status: "Available",
  },
  {
    title: "AI tool graph",
    copy: "CAD briefs already pull strategy, kickoff, and FMEA where wired. Broader cross-engine auto-routing is still shipping.",
    status: "Shipping",
  },
];

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "Available" ? "available" : status === "Shipping" ? "shipping" : "setup";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense marketing-pro">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero brand-route-hero">
          <p className="brand-hero-wordmark route-wordmark">Vantage</p>
          <h1>Shipped competition ops. Honest status labels.</h1>
          <p>
            From trusted scouting and day-of command through kickoff CAD, logistics, sponsors, knowledge, and grounded
            AI—previews use labeled fixtures; live product stays empty until real data exists.
          </p>
          <div className="route-hero-actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
          <div className="status-legend route-status-legend" aria-label="Status legend">
            <StatusBadge status="Available" />
            <StatusBadge status="Shipping" />
            <StatusBadge status="Setup required" />
          </div>
        </header>

        <section className="gallery-feature">
          <div>
            <small className="section-id">FRC ASSISTANT</small>
            <StatusBadge status="Available" />
            <h2>Competition ops and intel in one grounded thread.</h2>
            <p>
              Strategy, matchups, opponent history, and robot capabilities—fed by scouting and public metrics with
              provenance intact. Empty workspace stays empty.
            </p>
            <a className="text-link" href="/features/strategy#frc-assistant">
              Open Assistant &amp; Strategy →
            </a>
          </div>
          <AssistantPreview />
        </section>

        <section className="gallery-feature reverse">
          <div>
            <small className="section-id">STRATEGY</small>
            <StatusBadge status="Available" />
            <h2>Inspectable win/loss, then a playbook the drive team can use.</h2>
            <p>
              Probabilities, confidence, factors, what-if assumptions, and pick lists weighted with your synced scout
              observations—not volume alone.
            </p>
            <a className="text-link" href="/features/strategy">
              Open strategy detail →
            </a>
          </div>
          <StrategyPreview />
        </section>

        <section className="gallery-feature">
          <div>
            <small className="section-id">CAD</small>
            <StatusBadge status="Setup required" />
            <h2>Confirm the brief before geometry changes.</h2>
            <p>
              Kickoff and strategy constraints become an action plan with human approval on each step—Onshape OAuth or a
              paired Fusion/terminal relay.
            </p>
            <a className="text-link" href="/features/cad">
              Open CAD detail →
            </a>
          </div>
          <CadPreview />
        </section>

        <section className="gallery-feature reverse">
          <div>
            <small className="section-id">CODE</small>
            <StatusBadge status="Available" />
            <h2>Flag robot-code risk. Teach the safer habit.</h2>
            <p>
              Repository-aware WPILib reviews return human-approved diffs. Vantage never claims to deploy code to a
              robot.
            </p>
            <a className="text-link" href="/features/code">
              Open code detail →
            </a>
          </div>
          <CodePreview />
        </section>

        <section className="supporting-gallery" id="supporting-ops">
          <header>
            <span className="section-id">AROUND THE SEASON</span>
            <h2>The rest of the product, labeled honestly.</h2>
          </header>
          <div className="supporting-status-grid">
            {surfaces.map((item) => (
              <article key={item.title}>
                <StatusBadge status={item.status} />
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-preview">
          <div>
            <span className="section-id">NEXT</span>
            <h2>Join the waitlist or review raised plans.</h2>
            <p>
              Free competition core with BYOK. Paid Individual and Team plans include managed API allowance at list
              rates. Legal: <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>.
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
