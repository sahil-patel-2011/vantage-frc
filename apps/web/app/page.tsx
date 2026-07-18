import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import {
  CadPreview,
  ScoutPreview,
  StrategyPreview,
} from "../components/marketing/product-demos";
import { FAQ } from "../components/marketing/faq";

type Status = "Available" | "Shipping" | "Setup required";

const capabilities: {
  id: string;
  title: string;
  copy: string;
  status: Status;
}[] = [
  {
    id: "scouting",
    title: "Scouting trust · QR · offline",
    copy: "Match and pit forms keep working without venue Wi-Fi. QR handoffs move assignments. Synced facts include disagreement review, coverage gaps, and reliability signals.",
    status: "Available",
  },
  {
    id: "event-day",
    title: "Event Day · My Day",
    copy: "Shared next-match and readiness for the whole crew. Personal shifts, todos, and acknowledgements so each person knows what they own.",
    status: "Available",
  },
  {
    id: "kickoff-cad",
    title: "Kickoff → CAD",
    copy: "Season constraints and strategy intent become CAD briefs with human checkpoints. Onshape OAuth or a local Fusion/terminal relay must be configured.",
    status: "Setup required",
  },
  {
    id: "logistics",
    title: "Logistics",
    copy: "Travel legs, lodging, packing lists, and on-duty slots live beside the competition calendar—not a parallel spreadsheet season.",
    status: "Available",
  },
  {
    id: "business",
    title: "Sponsors · grants · orders",
    copy: "Sponsor pipeline and follow-ups, grant writing assist with clear AI labels, and purchase orders in the same Business hub.",
    status: "Available",
  },
  {
    id: "knowledge",
    title: "Team knowledge",
    copy: "Org-scoped wiki and handoff templates so mentors, students, and the Assistant read the same procedures.",
    status: "Available",
  },
  {
    id: "ai-graph",
    title: "AI tool graph",
    copy: "Assistant and CAD already pull strategy, kickoff, and FMEA where wired. Broader cross-engine tool routing is still shipping.",
    status: "Shipping",
  },
  {
    id: "hubs",
    title: "Product hubs",
    copy: "Competition, Team, Business, Build, and AI hubs group the season so navigation matches how teams actually work.",
    status: "Available",
  },
];

const hubs = [
  {
    name: "Competition",
    routes: "Command · My Day · Strategy · Scouting · Pick clock",
  },
  {
    name: "Team",
    routes: "Calendar · Todos · Messages · Practice · Knowledge",
  },
  {
    name: "Business",
    routes: "Budget · Orders · Sponsors · Sponsorship · Grants",
  },
  {
    name: "Build",
    routes: "Kickoff · CAD · Code · FMEA · Batteries",
  },
  {
    name: "AI",
    routes: "Chat · Budgets · Governance · Finance toggle",
  },
];

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "Available" ? "available" : status === "Shipping" ? "shipping" : "setup";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

export default function Home() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense marketing-pro">
      <SiteHeader />
      <main>
        <section className="brand-hero brand-hero-pro" aria-labelledby="brand-hero-title">
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
            <h1 id="brand-hero-title">Competition operations for FRC teams—shipped, not vapor.</h1>
            <p>
              Scout with trust, run Event Day, move kickoff into CAD, manage logistics and fundraising, keep knowledge
              durable, and meter AI under one invite-only organization.
            </p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="#capabilities">
                See what&apos;s available
              </a>
            </div>
          </div>
        </section>

        <section className="status-legend-band" aria-label="Feature status legend">
          <StatusBadge status="Available" />
          <span>Works in the product today</span>
          <StatusBadge status="Shipping" />
          <span>In active build; not claimed as complete</span>
          <StatusBadge status="Setup required" />
          <span>Needs connector or admin config</span>
        </section>

        <section className="product-thesis thesis-rule" id="capabilities" aria-labelledby="thesis-title">
          <span className="section-id">THE PRODUCT</span>
          <h2 id="thesis-title">One shared season—not five tabs and a group chat.</h2>
          <p>
            Vantage connects scouting, day-of ops, build, travel, fundraising, knowledge, and metered AI under the same
            organization and active event. Empty context stays empty. Approvals stay human. Status badges below are
            deliberate.
          </p>
        </section>

        <section className="capability-overview" aria-labelledby="cap-title">
          <header>
            <span className="section-id">CAPABILITIES</span>
            <h2 id="cap-title">Real surfaces teams already use.</h2>
            <p>
              These are product routes and workflows—not a roadmap slide. Labels match what is live versus still
              shipping.
            </p>
          </header>
          <div className="capability-grid">
            {capabilities.map((item) => (
              <article className="capability-card" id={item.id} key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
                <StatusBadge status={item.status} />
              </article>
            ))}
          </div>
        </section>

        <section className="ops-preview-band" aria-labelledby="proof-title">
          <header>
            <span className="section-id">IN THE PRODUCT</span>
            <h2 id="proof-title">Labeled previews of the loop that matters.</h2>
            <p>
              Deterministic demo fixtures for marketing only. Signed-in surfaces stay empty until real workspace, event,
              and data exist.
            </p>
          </header>
          <div className="ops-preview-grid">
            <ScoutPreview />
            <StrategyPreview />
            <CadPreview />
          </div>
        </section>

        <section className="hub-band" aria-labelledby="hubs-title">
          <header>
            <span className="section-id">HUBS</span>
            <h2 id="hubs-title">Navigate the season the way teams work.</h2>
            <p>
              Five Soft-UI hubs group competition, team ops, business, build, and AI—so members land where their job
              actually lives.
            </p>
            <StatusBadge status="Available" />
          </header>
          <div className="hub-grid">
            {hubs.map((hub) => (
              <article key={hub.name}>
                <h3>{hub.name}</h3>
                <p>{hub.routes}</p>
              </article>
            ))}
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
                <li>Sponsor asks, grants, and orders in another inbox</li>
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
                <li>Logistics, sponsors, grants, and orders in one org</li>
                <li>Kickoff → strategy → approval-gated CAD</li>
                <li>Assistant grounded and source-labeled; tool graph still shipping</li>
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
              Free covers scouting, reference data, manual strategy, exports, and team ops with BYOK or local AI. Paid
              plans add managed routing and included API allowance at provider list rates—then a hard stop unless you buy
              Usage Credits or enable PAYG. Individual Pro $49 · Max $79 · Team Pro $149 · Team Max $299.
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
              Join the prelaunch list. Account verification, <a href="/terms">terms</a>, <a href="/privacy">privacy</a>,
              and administrator-created team access remain separate launch steps. See <a href="/pricing">pricing</a> for
              plan details.
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
