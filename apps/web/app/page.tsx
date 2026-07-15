import type { ReactNode } from "react";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { CadPreview, CodePreview, StrategyPreview, WorkflowStrip } from "../components/marketing/product-demos";

const capIcons: Record<string, ReactNode> = {
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9.5 4h5v2.5h-5z" /><path d="M9 11.5h6M9 15h4" /></>),
  activity: (<path d="M3 12h4l2.5 6 4-15 2.5 9H21" />),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.3" /></>),
  flag: (<><path d="M6 21V4" /><path d="M6 5h11l-2 3 2 3H6" /></>),
  cube: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12.2 4.3 7.8M12 12.2l7.7-4.4M12 12.2V21" /></>),
  code: (<path d="M9 8.5 5 12l4 3.5M15 8.5 19 12l-4 3.5" />),
  monitor: (<><rect x="3" y="4.5" width="18" height="12" rx="1.6" /><path d="M9 20h6M12 16.5V20" /></>),
  export: (<><path d="M12 3.5v10M8.5 10l3.5 3.5L15.5 10" /><path d="M5 20h14" /></>),
};

function CapIcon({ name }: { name: string }) {
  return (
    <span className="cap-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {capIcons[name]}
      </svg>
    </span>
  );
}

const capabilities = [
  { icon: "clipboard", status: "Available", title: "Offline scouting", copy: "Attributed match and pit forms with voice notes and media that keep working when venue Wi-Fi doesn’t." },
  { icon: "activity", status: "Available", title: "Live match data", copy: "The Blue Alliance and Statbotics, cached, deduped, and freshness-stamped for your active event." },
  { icon: "target", status: "Available", title: "Win / loss prediction", copy: "A weighted-current model reporting confidence, key factors, and its own tracked Brier accuracy." },
  { icon: "flag", status: "Available", title: "Strategy & pick lists", copy: "Explicit what-if assumptions, alliance playbooks, and durable pick lists your team can defend." },
  { icon: "cube", status: "Setup required", title: "AI CAD builder", copy: "Turn a confirmed brief into approval-gated Onshape or Fusion geometry with verified checkpoints." },
  { icon: "code", status: "Available", title: "FRC code review", copy: "Repository-aware robot-code risk checks delivered as human-approved diffs — never auto-deployed." },
  { icon: "monitor", status: "Available", title: "Pit & TV displays", copy: "Offline-aware kiosk boards for the pit and stands: next match, readiness, and win predictions." },
  { icon: "export", status: "Available", title: "Exports & team ops", copy: "Auditable CSV/ZIP exports, organization roles, usage budgets, and human approval gates." },
];

const supporting = [
  {
    status: "Available",
    title: "Scout → predict → strategize",
    copy: "Attributed offline forms, weighted-current predictions, explicit what-if assumptions, and playbooks share one event context.",
  },
  {
    status: "Setup required",
    title: "CAD → code handoff",
    copy: "Strategy-linked engineering briefs and repository risk reviews stay approval-gated; connectors report setup state honestly.",
  },
  {
    status: "Available",
    title: "Offline / event ops",
    copy: "Active event queue, conflict review, pit and stands displays, and maintenance handoffs continue when venue Wi-Fi does not.",
  },
  {
    status: "Available",
    title: "Team privacy / setup",
    copy: "Organization membership, row-level scope, usage budgets, and human approval on CAD mutation and code proposals.",
  },
] as const;

export default function Home() {
  return (
    <div className="marketing-site marketing-v2">
      <SiteHeader />
      <main>
        <section className="v2-hero">
          <div className="v2-hero-copy">
            <span className="section-id">COMPETITION SOFTWARE FOR FRC</span>
            <h1>Evidence that stays usable from the stands to the shop.</h1>
            <p>
              Vantage is built for coaches, mentors, and students who need one shared event context across
              scouting, win/loss strategy, CAD work, and robot-code review—without inventing certainty the
              data cannot support.
            </p>
            <div className="actions">
              <a className="button primary" href="#hero-email">
                Join the waitlist
              </a>
              <a className="button secondary" href="/features">
                Product gallery
              </a>
            </div>
            <div className="hero-trust" aria-label="How Vantage works">
              <span>Offline-first capture</span>
              <span>Source-attributed data</span>
              <span>Team-private by default</span>
              <span>Human-approved AI</span>
            </div>
            <p className="hero-note">No fabricated metrics. Previews below use deterministic demo fixtures.</p>
          </div>
          <div className="hero-demo-frame">
            <StrategyPreview compact />
          </div>
        </section>

        <section className="capability-overview" aria-labelledby="capabilities-title">
          <header>
            <span className="section-id">WHAT VANTAGE DOES</span>
            <h2 id="capabilities-title">One platform for the entire competition loop.</h2>
            <p>
              Scout, forecast, strategize, build, and present from a single shared event context—every number
              carries its source, and every AI action stays behind a human decision.
            </p>
          </header>
          <div className="capability-grid">
            {capabilities.map((item) => (
              <article className="capability-card" key={item.title}>
                <CapIcon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
                <span className={`app-badge ${item.status === "Available" ? "good" : "setup"}`}>{item.status}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="hero-waitlist" id="hero-waitlist" aria-labelledby="hero-waitlist-title">
          <div>
            <span className="section-id">EARLY ACCESS</span>
            <h2 id="hero-waitlist-title">Bring one team context into the next event.</h2>
            <p>Joining the list does not create an account. Verification and administrator-created team access remain separate launch steps.</p>
          </div>
          <WaitlistForm idPrefix="hero" compact />
        </section>

        <section className="signature-intro">
          <span className="section-id">SIGNATURE CAPABILITIES</span>
          <h2>Three implemented engines. Same provenance model.</h2>
          <p>
            Each preview is labeled demo data from deterministic fixtures. The signed-in Strategy page stays empty
            until workspace, event, and TBA/Statbotics metrics exist — it does not invent win probability. Status labels stay honest: Available, Setup required, or Planned.
          </p>
        </section>

        <section className="signature-section strategy-signature">
          <div className="signature-copy">
            <span className="app-badge good">Available</span>
            <small>01 / WIN–LOSS + STRATEGY ENGINE</small>
            <h2>See the probability. Inspect the factors. Build the playbook.</h2>
            <p>
              The weighted-current model reports confidence, effective sample size, key factors, and caveats.
              What-if changes remain explicit assumptions; playbooks preserve priorities and debrief prompts.
            </p>
            <ul>
              <li>Probability with confidence interval</li>
              <li>What-if, defense, and role planning</li>
              <li>Outcome accuracy and Brier history in-product</li>
            </ul>
            <a className="text-link" href="/features/strategy">
              Explore the Strategy Engine →
            </a>
          </div>
          <StrategyPreview />
        </section>

        <section className="signature-section cad-signature-v2">
          <CadPreview />
          <div className="signature-copy">
            <span className="app-badge setup">Setup required</span>
            <small>02 / AI CAD BUILDER</small>
            <h2>Confirm engineering intent before geometry changes.</h2>
            <p>
              A strategy-linked brief becomes requirements, assumptions, a reviewed action plan,
              approval-gated steps, and verified topology/render checkpoints—only after connectors are configured.
            </p>
            <ul>
              <li>Onshape hosted path with configured OAuth</li>
              <li>Fusion 360 execution through a paired local relay</li>
              <li>Versioned artifacts, checkpoints, and BOM context</li>
            </ul>
            <a className="text-link" href="/features/cad">
              Explore the CAD Builder →
            </a>
          </div>
        </section>

        <section className="signature-section code-signature">
          <div className="signature-copy">
            <span className="app-badge good">Available</span>
            <small>03 / FRC CODE BUILDER / DEBUGGER</small>
            <h2>Find robot-code risk before it reaches hardware.</h2>
            <p>
              Repository-aware reviews identify WPILib and vendor-pattern risks, attach file evidence, and
              package proposed changes as human-approved unified diffs. Vantage does not deploy code to a robot.
            </p>
            <ul>
              <li>Blocking loops, CAN IDs, units, and disabled-state checks</li>
              <li>Test, simulation, and code-freeze artifacts</li>
              <li>Proposal only—no autonomous robot deployment claim</li>
            </ul>
            <a className="text-link" href="/features/code">
              Explore Code Builder / Debugger →
            </a>
          </div>
          <CodePreview />
        </section>

        <section className="workflow-band">
          <header>
            <span className="section-id">SUPPORTING WORKFLOW</span>
            <h2>Scout → predict → strategize → CAD → code</h2>
            <p>Sources, organization scope, active event, assumptions, and approvals travel with the work.</p>
          </header>
          <WorkflowStrip />
          <a className="text-link" href="/workflow">
            See the complete system workflow →
          </a>
        </section>

        <section className="supporting-strip">
          <header>
            <span className="section-id">AROUND THE ENGINES</span>
            <h2>Operations that supply and carry the decisions.</h2>
          </header>
          <div>
            {supporting.map((item) => (
              <article key={item.title}>
                <span className={`app-badge ${item.status === "Available" ? "good" : "setup"}`}>{item.status}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="trust-controls">
          <div>
            <span className="section-id">TEAM PRIVACY / SETUP</span>
            <h2>Technical controls are part of the product.</h2>
          </div>
          <ul>
            <li>
              <strong>Team-private boundaries</strong>
              <span>Organization context and row-level database policies scope protected work.</span>
            </li>
            <li>
              <strong>Visible sources</strong>
              <span>Official metrics, observations, research, predictions, and model inference remain distinct.</span>
            </li>
            <li>
              <strong>Usage limits</strong>
              <span>Provider policy, budgets, and hard caps are checked before managed calls.</span>
            </li>
            <li>
              <strong>Approval gates</strong>
              <span>CAD mutation and code proposals remain reviewable human decisions.</span>
            </li>
          </ul>
        </section>

        <section className="pricing-preview">
          <div>
            <span className="section-id">PRICING</span>
            <h2>Start with the complete non-AI competition core.</h2>
            <p>
              Free supports scouting, reference data, manual strategy, exports, and team operations. Paid
              individual and team plans fund managed AI deliberately, with published credits and hard controls.
            </p>
          </div>
          <a className="button secondary" href="/pricing">
            Review plans and controls
          </a>
        </section>

        <section className="waitlist v2-final-waitlist" id="waitlist">
          <div>
            <span className="section-id">EARLY ACCESS</span>
            <h2>Put one operational picture in front of the whole team.</h2>
            <p>
              Join the prelaunch list. Account verification, current terms, and administrator-created team
              access remain separate launch steps.
            </p>
          </div>
          <WaitlistForm idPrefix="final" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
