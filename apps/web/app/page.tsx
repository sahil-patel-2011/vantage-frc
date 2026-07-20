import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual, ProductGlances } from "../components/marketing/product-glances";
import { raisedPricingStrip, raisedPricingSummaryLine } from "@vantage/billing/catalog";

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
    id: "form-builder",
    title: "Custom scouting form builder",
    copy: "Owners publish versioned match and pit schemas with drivetrain, robot photos, and free-text fields—then scouts enter on the Soft-UI hub.",
    status: "Available",
  },
  {
    id: "scout-voice",
    title: "Scout voice notes",
    copy: "Opt-in voice notes attach to scout entries (never overwrite form fields). Browser STT works locally; cloud STT is metered when configured.",
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
    id: "strategy-tools",
    title: "Strategy Soft-UI tools",
    copy: "Win/loss, what-if, playbooks, and the Soft-UI pick desk (draft, collab, pick clock)—built from real TBA/Statbotics and scout facts, never DEMO win rates.",
    status: "Available",
  },
  {
    id: "business",
    title: "Business hub · sponsors · grants · orders",
    copy: "Soft-UI fundraising glance, sponsor pipeline and follow-ups, grant writing assist with clear AI labels, and purchase orders in one Business hub.",
    status: "Available",
  },
  {
    id: "knowledge",
    title: "Team knowledge",
    copy: "Org-scoped wiki and handoff templates so mentors, students, and the Assistant read the same procedures.",
    status: "Available",
  },
  {
    id: "usage-cutoffs",
    title: "Hard usage cutoffs",
    copy: "Included managed API allowance hard-stops at 100%—no silent overage. Resume with Usage Credits, explicit PAYG + spend cap, or a higher plan.",
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
    title: "Soft-UI product hubs",
    copy: "Competition, Team, Business, Build, and AI hubs group the season in one Soft-UI shell—so navigation matches how teams actually work.",
    status: "Available",
  },
];

const hubs = [
  {
    name: "Competition",
    routes: "Command · My Day · Strategy · Scouting · Form builder · Voice notes · Match checklist",
  },
  {
    name: "Team",
    routes: "Calendar · Todos · Messages · Practice · Knowledge · Attendance",
  },
  {
    name: "Business",
    routes: "Overview · Budget · Orders · Sponsors · Sponsorship · Grants",
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
    <div className="marketing-site marketing-v2 marketing-dense marketing-pro marketing-quiet">
      <SiteHeader />
      <main>
        <section className="brand-hero brand-hero-light" aria-labelledby="brand-hero-title">
          <div className="brand-hero-copy">
            <p className="brand-hero-wordmark">Vantage</p>
            <h1 id="brand-hero-title">Competition operations for FRC teams.</h1>
            <p>
              One shared season for scouting, Event Day, strategy, CAD, logistics, and metered AI—invite-only, with
              honest empty states.
            </p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="/pricing">
                View pricing
              </a>
            </div>
          </div>
          <HeroProductVisual />
        </section>

        <section className="product-thesis thesis-rule" id="capabilities" aria-labelledby="thesis-title">
          <span className="section-id">THE PRODUCT</span>
          <h2 id="thesis-title">One shared season—not five tabs and a group chat.</h2>
          <p>
            Vantage connects scouting, day-of ops, build, travel, fundraising, knowledge, and metered AI under the same
            organization and active event. Empty context stays empty. Approvals stay human.
          </p>
        </section>

        <section className="ops-preview-band product-show" aria-labelledby="proof-title">
          <header>
            <span className="section-id">IN THE PRODUCT</span>
            <h2 id="proof-title">Clear surfaces. No dashboard clutter.</h2>
            <p>Three calm looks at how teams actually work in Vantage.</p>
          </header>
          <ProductGlances />
        </section>

        <section className="capability-overview" aria-labelledby="cap-title">
          <header>
            <span className="section-id">CAPABILITIES</span>
            <h2 id="cap-title">What ships today.</h2>
            <p>
              Product routes and workflows—not a roadmap slide. Status labels match what is live versus still shipping.
            </p>
            <div className="status-legend" aria-label="Feature status legend">
              <StatusBadge status="Available" />
              <span className="status-legend-note">Works today</span>
              <StatusBadge status="Shipping" />
              <span className="status-legend-note">In active build</span>
              <StatusBadge status="Setup required" />
              <span className="status-legend-note">Needs connector</span>
            </div>
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

        <section className="hub-band" aria-labelledby="hubs-title">
          <header>
            <span className="section-id">HUBS</span>
            <h2 id="hubs-title">Soft-UI hubs match how teams work.</h2>
            <p>
              Five hubs group competition, team ops, business, build, and AI—so members land where their job actually
              lives.
            </p>
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
                <li>Custom forms + voice notes + QR → attributed team facts</li>
                <li>Event Day / My Day for shared and personal work</li>
                <li>Soft-UI Business hub for sponsors, grants, and orders</li>
                <li>Kickoff → Soft-UI strategy/picks → approval-gated CAD</li>
                <li>Assistant grounded and source-labeled; hard AI cutoffs</li>
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
              Usage Credits or enable PAYG.
            </p>
            <ul className="pricing-price-strip" aria-label="Raised monthly plan prices">
              {raisedPricingStrip().map((item) => (
                <li key={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.price}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Review plans
            </a>
          </div>
        </section>

        <FAQ />

        <section className="waitlist v2-final-waitlist soft-waitlist-band" id="waitlist">
          <div>
            <p className="brand-hero-wordmark route-wordmark waitlist-wordmark">Vantage</p>
            <span className="section-id">EARLY ACCESS</span>
            <h2>Put one operational picture in front of the whole team.</h2>
            <p>
              Join the prelaunch list—terms acceptance is required. Account verification and administrator-created team
              access remain separate launch steps. Raised plans: {raisedPricingSummaryLine()} on{" "}
              <a href="/pricing">pricing</a>. Read <a href="/terms">terms</a> and <a href="/privacy">privacy</a>.
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
