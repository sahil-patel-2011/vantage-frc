import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

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
    body: "Show WPILib-aligned alternatives: timestamps, stateful commands, typed control requests, and reviewed hardware maps—not an opaque one-click rewrite.",
  },
  {
    id: "04",
    title: "Build & debug assist",
    body: "Package proposals as unified diffs that require mentor or student approval. Simulation and code-freeze checks stay with the team.",
  },
];

export default function CodeFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Flag risky patterns—then teach the safer habit.</h1>
          <p>
            A learning coach for FRC software: reviews repository input for robot-loop and hardware risks, explains why
            those patterns fail under match pressure, and shows better approaches. Changes stay human-approved diffs.
          </p>
          <div className="actions">
            <a className="button primary" href="/signin">
              Sign in to use Code
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="code-capabilities-title">
          <header className="lux-section-head">
            <h2 id="code-capabilities-title">Review, explain, suggest—always with an approval gate.</h2>
          </header>
          <ul className="lux-pillar-list">
            {capabilities.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="product-glances-note">
            Marketing copy only. Signed-in Code stays empty until a repository and review context exist.
          </p>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Join the waitlist or explore the product.</h2>
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
