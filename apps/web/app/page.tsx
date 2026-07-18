import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import {
  CadPreview,
  ScoutPreview,
  StrategyPreview,
} from "../components/marketing/product-demos";
import { FAQ } from "../components/marketing/faq";

const pillars = [
  {
    id: "scouting",
    kicker: "01 / SCOUTING TRUST",
    title: "Scout offline. Sync with attribution. Trust the evidence.",
    copy: "Match and pit forms keep working without venue Wi-Fi. QR handoffs move assignments between devices. Synced observations become team-shared facts—with disagreement review, coverage gaps, and reliability signals so pick lists weigh evidence, not volume.",
    points: [
      "Offline-first forms with automatic sync",
      "QR scout handoff when Wi-Fi is unreliable",
      "Trust layer: disagreements, gaps, reliability",
    ],
  },
  {
    id: "event-day",
    kicker: "02 / EVENT DAY · MY DAY",
    title: "One shared event picture—and a personal day that stays clear.",
    copy: "Event Day command puts next match, readiness, duties, and pit signals in front of the whole crew. My Day surfaces your shifts, todos, and acknowledgements so nobody hunts the group chat for what they own.",
    points: [
      "Shared next-match and readiness board",
      "Personal shifts, todos, and check-ins",
      "Pit and TV boards that stay offline-aware",
    ],
  },
  {
    id: "kickoff-cad",
    kicker: "03 / KICKOFF → CAD",
    title: "From game manual to approval-gated geometry.",
    copy: "Kickoff captures season constraints and strategy intent. Those requirements can become CAD briefs with human checkpoints before Onshape or Fusion mutates anything—so build changes keep the match reason that created them.",
    points: [
      "Kickoff brief tied to active season context",
      "Strategy constraints linked into CAD work",
      "Onshape OAuth or local Fusion/terminal relay",
    ],
  },
  {
    id: "logistics",
    kicker: "04 / LOGISTICS",
    title: "Travel, lodging, and packing beside the calendar.",
    copy: "Leave times, hotel nights, venue arrival, and return legs live next to competition days—not in a separate spreadsheet season. Packing and duties stay org-scoped with the same event.",
    points: [
      "Travel legs and lodging on the trip timeline",
      "Packing lists and owned duties",
      "Visit invites without another tool",
    ],
  },
  {
    id: "sponsors",
    kicker: "05 / SPONSORS · GRANTS",
    title: "Pipeline, asks, and grant drafts in the same workspace.",
    copy: "Sponsor CRM, follow-ups, and value props sit next to impact proof. Grant writing assist drafts from real team context—with honest labels when AI helps—so fundraising is not a parallel season.",
    points: [
      "Sponsor pipeline and reminder cadence",
      "Ask drafts grounded in team facts",
      "Grant assist with clear AI disclosure",
    ],
  },
  {
    id: "knowledge",
    kicker: "06 / KNOWLEDGE",
    title: "Procedures that survive the season—and feed the Assistant.",
    copy: "Team wiki and durable notes stay org-scoped so humans and the FRC Assistant read the same procedures. No more lost Google Docs the night before quals.",
    points: [
      "Org-scoped wiki and season notes",
      "Readable by Assistant when allowed",
      "Continuity across mentors and students",
    ],
  },
  {
    id: "ai",
    kicker: "07 / AI INTEGRATION",
    title: "Grounded Assistant, inspectable strategy, human-gated build.",
    copy: "Managed AI routes through the same event context as scouting and strategy. Answers stay source-labeled. Strategy probabilities show confidence and caveats. CAD and code stay proposal-only until a person approves—never silent robot deploys.",
    points: [
      "FRC Assistant grounded in scout + TBA facts",
      "Win/loss with confidence, factors, and what-ifs",
      "Code review and CAD behind human approval",
    ],
  },
];

export default function Home() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense">
      <SiteHeader />
      <main>
        <section className="brand-hero" aria-labelledby="brand-hero-title">
          <div className="brand-hero-plane" aria-hidden="true">
            <div className="brand-hero-grid" />
            <div className="brand-hero-field">
              <span />
              <span />
              <span />
            </div>
            <svg className="brand-hero-mark" viewBox="0 0 120 120" fill="none">
              <path d="M18 22h14l36 68 36-68h14L68 108z" fill="currentColor" opacity=".18" />
              <path d="M18 46h14l36 42-8 14zM18 70h14l28 28-8 14z" fill="currentColor" />
              <rect x="60" y="88" width="12" height="12" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-hero-copy">
            <p className="brand-hero-wordmark">Vantage</p>
            <h1 id="brand-hero-title">The competition OS for FRC teams.</h1>
            <p>
              Scout with trust, run Event Day, move kickoff into CAD, manage logistics and sponsors, and keep AI
              grounded in one invite-only workspace.
            </p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="#product">
                See the product
              </a>
            </div>
          </div>
        </section>

        <section className="product-thesis" id="product" aria-labelledby="thesis-title">
          <span className="section-id">THE PRODUCT</span>
          <h2 id="thesis-title">One shared season—not five tabs and a group chat.</h2>
          <p>
            Vantage connects scouting, day-of ops, build, travel, fundraising, knowledge, and metered AI under the
            same organization and active event. Empty context stays empty. Approvals stay human.
          </p>
        </section>

        <section className="pillar-stack" aria-label="Product pillars">
          {pillars.map((pillar) => (
            <article className="pillar-row" id={pillar.id} key={pillar.id}>
              <div className="pillar-copy">
                <small>{pillar.kicker}</small>
                <h2>{pillar.title}</h2>
                <p>{pillar.copy}</p>
                <ul>
                  {pillar.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>

        <section className="ops-preview-band" aria-labelledby="proof-title">
          <header>
            <span className="section-id">IN THE PRODUCT</span>
            <h2 id="proof-title">Labeled previews of the loop that matters.</h2>
            <p>
              Deterministic demo fixtures for marketing only. Signed-in surfaces stay empty until real workspace,
              event, and data exist.
            </p>
          </header>
          <div className="ops-preview-grid">
            <ScoutPreview />
            <StrategyPreview />
            <CadPreview />
          </div>
        </section>

        <section className="stitch-compare" aria-labelledby="stitch-title">
          <header>
            <span className="section-id">WHY TEAMS SWITCH</span>
            <h2 id="stitch-title">Stop stitching the season across five tools.</h2>
          </header>
          <div className="stitch-cols">
            <article className="stitch-old">
              <h3>Usual season</h3>
              <ul>
                <li>Scouting in a spreadsheet with no trust signals</li>
                <li>Event duties and travel in separate docs</li>
                <li>Sponsor asks and grants in another inbox</li>
                <li>CAD and strategy disconnected from match reason</li>
                <li>AI chat that invents context you do not have</li>
              </ul>
              <p>Disconnected tools, unclear provenance, no shared event picture.</p>
            </article>
            <article className="stitch-new">
              <h3>With Vantage</h3>
              <ul>
                <li>Offline scout + QR handoff → attributed team facts</li>
                <li>Event Day / My Day for shared and personal work</li>
                <li>Logistics, sponsors, and grants in the same org</li>
                <li>Kickoff → strategy → approval-gated CAD</li>
                <li>Assistant and strategy grounded, source-labeled</li>
              </ul>
              <p>One continuous loop—with honest empty states and human gates.</p>
            </article>
          </div>
        </section>

        <section className="pricing-preview" id="pricing-preview">
          <div>
            <span className="section-id">PRICING</span>
            <h2>Free competition core. Raised paid plans for managed AI.</h2>
            <p>
              Free covers scouting, reference data, manual strategy, exports, and team ops with BYOK or local AI.
              Paid plans add managed routing and included API allowance at provider list rates—then a hard stop unless
              you buy Usage Credits or enable PAYG. Individual Pro $49 · Max $79 · Team Pro $149 · Team Max $299.
            </p>
          </div>
          <a className="button secondary" href="/pricing">
            Review plans
          </a>
        </section>

        <FAQ />

        <section className="waitlist v2-final-waitlist" id="waitlist">
          <div>
            <span className="section-id">EARLY ACCESS</span>
            <h2>Put one operational picture in front of the whole team.</h2>
            <p>
              Join the prelaunch list. Account verification,{" "}
              <a href="/terms">terms</a>, <a href="/privacy">privacy</a>, and administrator-created team access
              remain separate launch steps. See <a href="/pricing">pricing</a> for plan details.
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
