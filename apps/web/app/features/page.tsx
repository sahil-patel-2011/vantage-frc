import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import {
  AssistantPreview,
  CadPreview,
  CodePreview,
  StrategyPreview,
} from "../../components/marketing/product-demos";

export const metadata: Metadata = {
  title: "Product gallery — Vantage",
  description:
    "Curated Vantage workflows: FRC Assistant, strategy, CAD, FRC code review, integrated scouting, intelligence, displays, and team operations.",
  alternates: { canonical: "/features" },
};

const support = [
  [
    "Available",
    "Scout once — feed the whole loop",
    "Offline match/pit forms sync into attributed facts that weight predictions, playbooks, pick lists, live boards, and FRC Assistant context.",
  ],
  [
    "Setup required",
    "Combine live event and team intelligence",
    "TBA and Statbotics-backed caches, freshness state, global team lookup, source-linked research, comparisons, and pick evidence.",
  ],
  [
    "Available",
    "Run the competition command layer",
    "Active event context, next-match queue, quick actions, offline status, team controls, display setup, and export center.",
  ],
  [
    "Available",
    "Keep team + private chat unified",
    "Org team channel and member DMs stay inside Vantage with the same membership boundary—no Discord/Slack disconnect for day-of ops.",
  ],
];

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-v2">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero">
          <span className="section-id">CURATED PRODUCT GALLERY</span>
          <h1>Assistant and engines. One competition context.</h1>
          <p>
            Marketing previews use labeled deterministic fixtures. Authenticated Strategy and the FRC Assistant stay
            empty until real match/metrics—and scout sync when you have it—exist. Connector states stay explicit:
            Available, Setup required, or Planned.
          </p>
        </header>
        <section className="gallery-feature">
          <div>
            <span className="app-badge good">Available</span>
            <h2>FRC Assistant</h2>
            <p>
              Competition ops and intel in one grounded thread: strategy, matchups, opponent history, and robot
              capabilities—fed by scouting and public metrics with provenance intact.
            </p>
            <a className="text-link" href="/features/strategy#frc-assistant">
              Open Assistant &amp; Strategy detail →
            </a>
          </div>
          <AssistantPreview />
        </section>
        <section className="gallery-feature reverse">
          <div>
            <span className="app-badge good">Available</span>
            <h2>Win / Loss + Strategy Engine</h2>
            <p>
              Inspect probabilities, confidence, factors, what-if assumptions, playbook priorities, and post-match
              accuracy—weighted with your synced scout observations.
            </p>
            <a className="text-link" href="/features/strategy">
              Open strategy detail →
            </a>
          </div>
          <StrategyPreview />
        </section>
        <section className="gallery-feature">
          <div>
            <span className="app-badge setup">Setup required</span>
            <h2>AI CAD Builder</h2>
            <p>Move from a confirmed brief to approval-gated Onshape or Fusion work and verified geometry artifacts.</p>
            <a className="text-link" href="/features/cad">
              Open CAD detail →
            </a>
          </div>
          <CadPreview />
        </section>
        <section className="gallery-feature reverse">
          <div>
            <span className="app-badge good">Available</span>
            <h2>FRC Code Builder / Debugger</h2>
            <p>
              Flag robot-specific risk, explain why it matters, teach safer WPILib habits, and prepare human-approved
              unified diffs—without claiming autonomous deployment.
            </p>
            <a className="text-link" href="/features/code">
              Open code detail →
            </a>
          </div>
          <CodePreview />
        </section>
        <section className="supporting-gallery">
          <header>
            <span className="section-id">SUPPORTING OPERATIONS</span>
            <h2>Scouting is the feed—not a sideshow.</h2>
          </header>
          <div>
            {support.map(([status, title, copy]) => (
              <article key={title}>
                <span className={`app-badge ${status === "Available" ? "good" : "setup"}`}>{status}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
