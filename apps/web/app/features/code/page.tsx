import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { CodePreview } from "../../../components/marketing/product-demos";

export const metadata: Metadata = {
  title: "FRC Code Builder / Debugger — Vantage",
  description:
    "FRC code review that flags risky robot patterns, explains why they matter, teaches safer WPILib habits, and proposes human-approved diffs—not autonomous robot code.",
  alternates: { canonical: "/features/code" },
};

const capabilities = [
  {
    id: "01",
    title: "Review risk",
    body: "Flag blocking loops, hard-coded CAN IDs, unbounded motor output, missing units, and disabled-state actuator writes with file evidence.",
  },
  {
    id: "02",
    title: "Explain why",
    body: "Each finding carries a teaching note—why Timer.delay in periodic() starves scheduling, sensors, and safety feeds—so students learn the failure mode.",
  },
  {
    id: "03",
    title: "Suggest safer habits",
    body: "Show WPILib-aligned alternatives: timestamps, stateful commands, typed control requests, and reviewed hardware maps—not a opaque one-click rewrite.",
  },
  {
    id: "04",
    title: "Build & debug assist",
    body: "Package proposals as unified diffs that require mentor or student approval. Simulation and code-freeze checks stay with the team.",
  },
];

export default function CodeFeaturePage() {
  return (
    <div className="marketing-site marketing-v2">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero split-hero code-route-hero">
          <div>
            <span className="section-id">FRC CODE BUILDER / DEBUGGER · AVAILABLE</span>
            <h1>Flag risky robot-code patterns—then teach the safer habit.</h1>
            <p>
              Vantage is a learning coach for FRC software practice: it reviews repository input for robot-loop and
              hardware risks, explains why those patterns fail under match pressure, and shows better approaches.
              Proposed changes stay human-approved unified diffs. It does not write your whole robot for you.
            </p>
            <a className="button primary" href="/signin">
              Sign in to use Code Builder / Debugger
            </a>
          </div>
          <CodePreview />
        </header>

        <section className="code-capability-grid" aria-labelledby="code-capabilities-title">
          <header>
            <span className="section-id">WHAT IT COVERS</span>
            <h2 id="code-capabilities-title">More than a findings panel.</h2>
            <p>Review, explain, suggest, and assist—always with evidence and an approval gate.</p>
          </header>
          <div>
            {capabilities.map((item) => (
              <article key={item.id}>
                <b>{item.id}</b>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="code-lesson-band" aria-labelledby="code-lesson-title">
          <div>
            <span className="section-id">TEACH, DON&apos;T JUST DO</span>
            <h2 id="code-lesson-title">A coach walks through the failure, then the fix.</h2>
            <p>
              Mentors stay in the loop. Students see the risky line, the match-day consequence, and a pattern they
              can reuse on the next subsystem—not an unreviewable bulk rewrite.
            </p>
          </div>
          <ol className="code-lesson-flow">
            <li>
              <b>01</b>
              <div>
                <h3>Flag</h3>
                <p>
                  <code>Timer.delay</code> inside <code>periodic()</code> blocks the robot thread.
                </p>
              </div>
            </li>
            <li>
              <b>02</b>
              <div>
                <h3>Explain</h3>
                <p>Command scheduling, sensor reads, and safety checks stall for the entire delay.</p>
              </div>
            </li>
            <li>
              <b>03</b>
              <div>
                <h3>Correct pattern</h3>
                <p>Use timestamps or stateful commands so the loop keeps running while work advances on a schedule.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="detail-proof-grid">
          <article>
            <b>01</b>
            <h2>FRC-specific findings</h2>
            <p>Severity, rule name, file/line evidence, and required robot-safe checks travel with every review.</p>
          </article>
          <article>
            <b>02</b>
            <h2>Versioned artifacts</h2>
            <p>Review output and code proposals store as organization-scoped artifacts with source provenance.</p>
          </article>
          <article>
            <b>03</b>
            <h2>No autonomous robot deploy</h2>
            <p>
              Teams still run tests, code review, code-freeze policy, and deployment through their own tooling.
            </p>
          </article>
        </section>

        <section className="technical-note">
          <span className="section-id">BOUNDARY</span>
          <h2>AI assistance is a coach—not engineering certification.</h2>
          <p>
            Suggested patterns and diffs are starting points for learning and review. Teams remain responsible for
            correctness, safety, rules compliance, and what runs on a robot.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
