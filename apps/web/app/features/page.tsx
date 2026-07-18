import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import {
  AssistantPreview,
  CadPreview,
  CodePreview,
  StrategyPreview,
} from "../../components/marketing/product-demos";

export const metadata: Metadata = {
  title: "Showcase — Vantage",
  description:
    "Vantage product showcase: scouting trust, Event Day and My Day, kickoff to CAD, logistics, sponsorship and grants, knowledge, offline QR, and grounded AI.",
  alternates: { canonical: "/features" },
};

const surfaces = [
  {
    title: "Scouting trust & offline QR",
    copy: "Offline match/pit forms, QR handoffs, disagreement review, coverage gaps, and reliability signals so strategy weighs evidence quality.",
  },
  {
    title: "Event Day + My Day",
    copy: "Shared command for next match and readiness, plus personal shifts, todos, and acknowledgements for what you own today.",
  },
  {
    title: "Kickoff → CAD",
    copy: "Season constraints become approval-gated Onshape or Fusion work so build changes keep the match reason that created them.",
  },
  {
    title: "Logistics",
    copy: "Travel legs, lodging, packing, and duties beside the competition calendar—not a parallel spreadsheet season.",
  },
  {
    title: "Sponsorship & grants",
    copy: "Sponsor pipeline, ask drafts, and grant writing assist with honest AI labels next to impact proof.",
  },
  {
    title: "Team knowledge",
    copy: "Org-scoped wiki and season notes the Assistant can read—durable procedures, not a lost Google Doc.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero brand-route-hero">
          <p className="brand-hero-wordmark route-wordmark">Vantage</p>
          <h1>Full-season operations. One competition context.</h1>
          <p>
            From trusted scouting and day-of command through kickoff CAD, logistics, sponsors, knowledge, and
            grounded AI—previews use labeled fixtures; live product stays empty until real data exists.
          </p>
          <div className="route-hero-actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </header>

        <section className="gallery-feature">
          <div>
            <small className="section-id">FRC ASSISTANT</small>
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
            <h2>Confirm the brief before geometry changes.</h2>
            <p>
              Kickoff and strategy constraints become an action plan with human approval on each step—Onshape OAuth
              or a paired Fusion/terminal relay.
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
            <span className="section-id">AROUND THE ENGINES</span>
            <h2>The rest of the season, in the same org.</h2>
          </header>
          <div>
            {surfaces.map((item) => (
              <article key={item.title}>
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
