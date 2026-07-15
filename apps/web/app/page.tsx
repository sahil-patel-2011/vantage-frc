import type { ReactNode } from "react";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import {
  AssistantPreview,
  CadPreview,
  CodePreview,
  DashboardPreview,
  DisplayPreview,
  ScoutPreview,
  StrategyPreview,
  TeamOpsPreview,
  WorkflowStrip,
} from "../components/marketing/product-demos";
import { FAQ } from "../components/marketing/faq";

const capIcons: Record<string, ReactNode> = {
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9.5 4h5v2.5h-5z" />
      <path d="M9 11.5h6M9 15h4" />
    </>
  ),
  activity: <path d="M3 12h4l2.5 6 4-15 2.5 9H21" />,
  chat: (
    <>
      <path d="M5 6h14v9H9l-4 4V6z" />
      <circle cx="9" cy="10.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10.5" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.3" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 5h11l-2 3 2 3H6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18.07" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12.2 4.3 7.8M12 12.2l7.7-4.4M12 12.2V21" />
    </>
  ),
  code: <path d="M9 8.5 5 12l4 3.5M15 8.5 19 12l-4 3.5" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19a6 6 0 0 1 12 0M16 8a3 3 0 1 1 0 6m2 5a5 5 0 0 0-3-4.5" />
    </>
  ),
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
  {
    icon: "clipboard",
    status: "Available",
    title: "Offline scouting → shared data",
    copy: "Match and pit forms keep working without venue Wi-Fi. Synced observations become team-shared facts with attribution—and they feed strategy, predictions, and the Assistant.",
  },
  {
    icon: "chat",
    status: "Available",
    title: "FRC Assistant for competition ops",
    copy: "Ask about strategy, matchups, opponent history, and robot capabilities inside your active event. Answers stay source-labeled; empty context stays empty.",
  },
  {
    icon: "target",
    status: "Available",
    title: "Win / loss from TBA + scout facts",
    copy: "Weighted-current predictions combine live TBA/Statbotics metrics with your scouted observations, then show confidence, factors, and caveats.",
  },
  {
    icon: "flag",
    status: "Available",
    title: "Strategy & pick lists",
    copy: "What-if assumptions stay labeled as assumptions. Playbooks and pick lists travel with the active event so drive team and strategy stay aligned.",
  },
  {
    icon: "link",
    status: "Available",
    title: "Scouting integrated—not a silo",
    copy: "One connected system: scout sync informs predictions, playbooks, pick lists, live boards, and Assistant context where it matters.",
  },
  {
    icon: "cube",
    status: "Setup required",
    title: "AI CAD · Fusion + terminal path",
    copy: "Confirm a brief, then run approval-gated steps through Onshape OAuth or a paired local Fusion/terminal relay—with checkpoints before geometry mutates.",
  },
  {
    icon: "code",
    status: "Available",
    title: "FRC code review",
    copy: "Repository-aware WPILib/vendor risk checks return human-approved diffs. Vantage never claims to deploy code to a robot.",
  },
  {
    icon: "monitor",
    status: "Available",
    title: "Live event / TV boards",
    copy: "Pit and stands kiosks show next match, readiness, and predictions offline-aware—so the queue survives flaky venue Wi-Fi.",
  },
  {
    icon: "grid",
    status: "Available",
    title: "Custom dashboard widgets",
    copy: "Rearrange next-match, readiness, alerts, and scouting coverage. Empty widgets stay empty until workspace, event, and TBA are connected.",
  },
  {
    icon: "users",
    status: "Available",
    title: "Invites, privacy, usage controls",
    copy: "Org-scoped membership, invite-only access, row-level boundaries, and hard AI usage budgets before managed calls run.",
  },
];

export default function Home() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense">
      <SiteHeader />
      <main>
        <section className="v2-hero thesis-rule">
          <div className="v2-hero-copy">
            <span className="section-id">COMPETITION OPS FOR FRC TEAMS</span>
            <h1>Scout, ask, decide, build, and present from one shared event.</h1>
            <p>
              Vantage is the operations layer for one FRC team: offline scouting that syncs into shared facts, an FRC
              Assistant for strategy and competitor intel, TBA/Statbotics-backed predictions, approval-gated AI CAD,
              robot-code review, live TV boards, and a customizable home dashboard—each number labeled with its source.
            </p>
            <div className="actions">
              <a className="button primary" href="#hero-email">
                Join the waitlist
              </a>
              <a className="button secondary" href="#product-substance">
                See what it does
              </a>
            </div>
            <div className="hero-spec" aria-label="How Vantage works">
              <b>Offline-first</b>
              <span>//</span>
              <b>Source-attributed</b>
              <span>//</span>
              <b>Invite-only</b>
              <span>//</span>
              <b>Human-gated AI</b>
            </div>
            <p className="hero-note">Previews use labeled demo fixtures. Live product pages stay empty until your workspace and event are set up.</p>
          </div>
          <div className="hero-demo-frame">
            <StrategyPreview compact />
          </div>
        </section>

        <section className="capability-overview" id="product-substance" aria-labelledby="capabilities-title">
          <header>
            <span className="section-id">WHAT YOU ACTUALLY GET</span>
            <h2 id="capabilities-title">Concrete workflows from pit to playoffs.</h2>
            <p>
              Not a feature laundry list—each module exists so scouting, the FRC Assistant, strategy, CAD, code, and pit
              displays share one organization-scoped event context.
            </p>
            <div className="status-legend">
              <span className="app-badge good">Available</span>
              <span className="app-badge setup">Setup required</span>
              <span className="status-legend-note">Status labels stay honest; setup paths are explicit.</span>
            </div>
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

        <section className="ops-preview-band" aria-labelledby="ops-title">
          <header>
            <span className="section-id">DAY-OF OPERATIONS</span>
            <h2 id="ops-title">How work moves during an event.</h2>
            <p>Labeled demo fixtures of scouting sync, the customizable home board, and pit/TV display state.</p>
          </header>
          <div className="ops-preview-grid">
            <ScoutPreview />
            <DashboardPreview />
            <DisplayPreview />
          </div>
        </section>

        <section className="stitch-compare" aria-labelledby="stitch-title">
          <header>
            <span className="section-id">WHY IT&apos;S DIFFERENT</span>
            <h2 id="stitch-title">Stop stitching the season across five tabs.</h2>
          </header>
          <div className="stitch-cols">
            <article className="stitch-old">
              <h3>Usual season</h3>
              <ul>
                <li>Scouting in a shared spreadsheet</li>
                <li>TBA &amp; Statbotics in other tabs</li>
                <li>CAD on someone&apos;s laptop</li>
                <li>Strategy on a whiteboard photo</li>
                <li>Decisions buried in group chat</li>
              </ul>
              <p>Disconnected tools, unclear provenance, and no shared event context.</p>
            </article>
            <article className="stitch-new">
              <h3>With Vantage</h3>
              <ul>
                <li>Scout offline → sync into team data</li>
                <li>FRC Assistant grounded in that same context</li>
                <li>Predict from TBA + scouted facts</li>
                <li>Strategy playbooks &amp; pick lists in-event</li>
                <li>CAD &amp; code behind human approval</li>
              </ul>
              <p>One continuous, source-labeled loop—scouting feeds the rest, not a silo.</p>
            </article>
          </div>
        </section>

        <section className="hero-waitlist" id="hero-waitlist" aria-labelledby="hero-waitlist-title">
          <div>
            <span className="section-id">EARLY ACCESS</span>
            <h2 id="hero-waitlist-title">Bring one team context to the next event.</h2>
            <p>Joining the list does not create an account. Verification and administrator-created team access remain separate launch steps.</p>
          </div>
          <WaitlistForm idPrefix="hero" compact />
        </section>

        <section className="signature-intro">
          <span className="section-id">CORE ENGINES</span>
          <h2>Assistant, strategy, CAD, and code—with the same provenance rules.</h2>
          <p>
            Each preview is labeled demo data. Signed-in Strategy and the FRC Assistant stay empty until workspace,
            event, and TBA/Statbotics (plus scout sync when you have it) exist—they do not invent win probability.
          </p>
        </section>

        <section className="signature-section assistant-signature" id="frc-assistant">
          <div className="signature-copy">
            <span className="app-badge good">Available</span>
            <small>00 / FRC ASSISTANT</small>
            <h2>Competition ops and intel in one grounded chat.</h2>
            <p>
              Ask about strategy, best matchups, what other teams tend to do from history, and robot capabilities.
              Scouting, TBA/Statbotics, and event context travel with the thread—so answers stay useful for drive team
              and strategy, not a detached chatbot.
            </p>
            <ul>
              <li>Strategy, matchups, and opponent patterns from attributed evidence</li>
              <li>Scout sync + public metrics kept distinct and labeled</li>
              <li>Feeds the same pick lists, playbooks, and live boards as the rest of the app</li>
            </ul>
            <a className="text-link" href="/features/strategy#frc-assistant">
              Explore FRC Assistant &amp; Strategy →
            </a>
          </div>
          <AssistantPreview />
        </section>

        <section className="signature-section strategy-signature">
          <div className="signature-copy">
            <span className="app-badge good">Available</span>
            <small>01 / WIN–LOSS + STRATEGY</small>
            <h2>Probability you can inspect, then a playbook the drive team can use.</h2>
            <p>
              Combine live TBA/Statbotics metrics with scouted observations. Confidence bands, key factors, and
              caveats stay visible. What-if changes are stored as assumptions—not as fake observations. Scout data is
              an input to the model and pick lists, not a separate spreadsheet nobody opens.
            </p>
            <ul>
              <li>Weighted-current model with confidence interval</li>
              <li>What-if, defense, and role planning</li>
              <li>Pick lists and debrief prompts in-event</li>
            </ul>
            <a className="text-link" href="/features/strategy">
              Explore Strategy →
            </a>
          </div>
          <StrategyPreview />
        </section>

        <section className="signature-section cad-signature-v2">
          <CadPreview />
          <div className="signature-copy">
            <span className="app-badge setup">Setup required</span>
            <small>02 / AI CAD · FUSION / TERMINAL</small>
            <h2>Confirm the brief before any geometry changes.</h2>
            <p>
              Strategy-linked requirements become an action plan with human approval on each step. Hosted Onshape
              OAuth or a paired local Fusion/terminal relay—connectors report setup state honestly.
            </p>
            <ul>
              <li>Onshape path with configured OAuth</li>
              <li>Fusion 360 via local relay / terminal</li>
              <li>Checkpoints before mutation; BOM context kept</li>
            </ul>
            <a className="text-link" href="/features/cad">
              Explore CAD Builder →
            </a>
          </div>
        </section>

        <section className="signature-section code-signature">
          <div className="signature-copy">
            <span className="app-badge good">Available</span>
            <small>03 / FRC CODE COACH</small>
            <h2>Flag robot-code risk, explain why, teach the safer habit.</h2>
            <p>
              Repository-aware reviews catch WPILib pattern risks with file evidence, then coach students through
              the failure mode and a better approach. Proposals stay human-approved unified diffs—no autonomous
              robot deploy.
            </p>
            <ul>
              <li>Blocking loops, CAN IDs, units, disabled-state checks</li>
              <li>Teach why a pattern fails under match pressure</li>
              <li>Proposal only—mentor or student must approve</li>
            </ul>
            <a className="text-link" href="/features/code">
              Explore Code Builder →
            </a>
          </div>
          <CodePreview />
        </section>

        <section className="workflow-band">
          <header>
            <span className="section-id">END-TO-END LOOP</span>
            <h2>Scout → predict → assist → strategize → build → present</h2>
            <p>
              Sources, org scope, active event, scout attributions, assumptions, and approvals travel with the work—so
              the FRC Assistant and Strategy see the same facts as pick lists and live boards.
            </p>
          </header>
          <WorkflowStrip />
          <a className="text-link" href="/workflow">
            See the full workflow →
          </a>
        </section>

        <section className="team-ops-section" aria-labelledby="team-ops-title">
          <div className="signature-copy">
            <span className="section-id">TEAM ACCESS &amp; CONTROLS</span>
            <h2 id="team-ops-title">Invites, privacy boundaries, and AI usage caps.</h2>
            <p>
              Access is waitlist- and invite-gated. Org admins manage membership; platform Global Team Manager stays
              locked to platform admins. Usage budgets hard-stop managed AI before spend surprises.
            </p>
            <ul>
              <li>Email invites into an organization-scoped workspace</li>
              <li>Row-level scope on protected competition data</li>
              <li>Team channel and private member messaging in-app</li>
              <li>Budgets and hard caps on managed AI calls</li>
            </ul>
          </div>
          <TeamOpsPreview />
        </section>

        <section className="pricing-preview">
          <div>
            <span className="section-id">PRICING</span>
            <h2>Start with the complete non-AI competition core.</h2>
            <p>
              Free covers scouting, reference data, manual strategy, exports, and team operations—the same core the FRC
              Assistant uses when AI is enabled. Paid plans add managed API allowance at provider list rates (no Vantage
              markup), then a hard stop unless you buy Usage Credits or enable PAYG.
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
              Join the prelaunch list. Account verification, current terms, and administrator-created team access
              remain separate launch steps.
            </p>
          </div>
          <WaitlistForm idPrefix="final" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
