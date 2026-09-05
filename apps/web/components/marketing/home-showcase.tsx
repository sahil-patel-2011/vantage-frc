/**
 * Homepage product story. Real hubs and tools. Never invented scores.
 */

import {
  MARKETING_HUBS,
  MARKETING_PROBLEMS,
  MARKETING_SEASON,
  MARKETING_TRUST,
  MARKETING_WORKSPACE_SENTENCE,
  MARKETING_WORKSPACES,
} from "../../lib/marketing/product-story";
import { MIcon } from "./marketing-icons";

const PIPELINE = [
  {
    step: "1",
    title: "Scout offline",
    copy: "Match and pit forms stay on the tablet. QR handoff and pit mesh cover other devices. Sync starts when the venue network comes back.",
  },
  {
    step: "2",
    title: "Check the notes",
    copy: "Disagreements, coverage, and accuracy come from real entries. Nothing is filled in for you.",
  },
  {
    step: "3",
    title: "Pick from evidence",
    copy: "Alliance desk, pick clock, and pairwise ranking use TBA plus scout facts — or stay empty. No DEMO EPA.",
  },
  {
    step: "4",
    title: "Run the rest of the day",
    copy: "Command, My Day, match checklist, pit repair, and strategy cards share the same event. No second app.",
  },
] as const;

export function HomeShowcase() {
  return (
    <>
      <section className="lux-problem" id="what-it-is" aria-labelledby="lux-define-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <p className="lux-eyebrow">What it is</p>
            <h2 id="lux-define-title">One workspace for the FRC season.</h2>
            <p>
              Mentors invite exact emails. After sign-in the menu is four workspaces — {MARKETING_WORKSPACE_SENTENCE} — and the
              same event context follows every desk. There is no public directory and no DEMO workspace.
            </p>
          </header>
          <ul className="lux-feature-grid lux-feature-grid-4">
            {MARKETING_WORKSPACES.map((workspace) => (
              <li key={workspace.id}>
                <span className="lux-card-icon">
                  <MIcon name={workspace.icon} />
                </span>
                <strong>{workspace.title}</strong>
                <span>{workspace.copy}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lux-problem" aria-labelledby="lux-problem-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">The problem</p>
            <h2 id="lux-problem-title">Your season lives in three places that forget.</h2>
            <p>Said plainly, because every mentor already knows it.</p>
          </header>
          <ul className="lux-feature-grid" data-reveal>
            {MARKETING_PROBLEMS.map((item) => (
              <li key={item.title}>
                <span className="lux-card-icon">
                  <MIcon name={item.icon} />
                </span>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ul>
          <p className="lux-closer" data-reveal>
            None of that is fixed by trying harder. It is what happens when the record of a season has no home.
          </p>
        </div>
      </section>

      <section className="lux-loop" id="how-it-works" aria-labelledby="lux-loop-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">How it works</p>
            <h2 id="lux-loop-title">Scout. Check. Decide. Run the day.</h2>
            <p>One event context. Each stage feeds the next from real data only.</p>
          </header>
          <ol className="lux-loop-steps lux-loop-steps-4" data-reveal>
            {PIPELINE.map((item) => (
              <li key={item.step}>
                <b aria-hidden="true">{item.step}</b>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lux-runs" aria-labelledby="lux-runs-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">Inside the workspaces</p>
            <h2 id="lux-runs-title">The desks a workspace opens.</h2>
            <p>Each hub is a handful of workbenches with related tools as tabs — not a dump of fake dashboards.</p>
          </header>
          <ul className="mk-pillars" data-reveal>
            {MARKETING_HUBS.map((hub) => (
              <li key={hub.id}>
                <a className="mk-pillar-link" href={hub.href}>
                  <span className="lux-card-icon">
                    <MIcon name={hub.icon} />
                  </span>
                  <span className="mk-tag">{hub.route}</span>
                  <strong>{hub.title}</strong>
                  <span className="mk-pillar-copy">{hub.promise}</span>
                  <span className="mk-pillar-mods">
                    {hub.modules.map((mod) => (
                      <span key={mod}>{mod}</span>
                    ))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mk-related-links" data-reveal>
            Deep dives: <a href="/features">Every hub and tool</a>
            {" · "}
            <a href="/features/strategy">Strategy</a>
            {" · "}
            <a href="/features/cad">CAD</a>
            {" · "}
            <a href="/features/code">Code Coach</a>
          </p>
        </div>
      </section>

      <section className="lux-loop" aria-labelledby="lux-season-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">The season</p>
            <h2 id="lux-season-title">The other forty weeks, too.</h2>
            <p>Competition is six weekends. Vantage covers shop, travel, money, and the robot between them.</p>
          </header>
          <ol className="lux-loop-steps lux-loop-steps-4" data-reveal>
            {MARKETING_SEASON.map((item, index) => (
              <li key={item.title}>
                <b aria-hidden="true">{String(index + 1)}</b>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lux-fit" aria-labelledby="lux-trust-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">Trust</p>
            <h2 id="lux-trust-title">What we will not invent.</h2>
            <p>If TBA, scouting, or a connector is not connected, the screen says so.</p>
          </header>
          <ul className="lux-feature-grid" data-reveal>
            {MARKETING_TRUST.map((item) => (
              <li key={item.title}>
                <span className="lux-card-icon">
                  <MIcon name={item.icon} />
                </span>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ul>
          <p className="mk-footnote" data-reveal>
            <b>CAD and code stay human-gated.</b> Mutations and Bugbot diffs need approval. Nothing is pushed to a robot
            or Onshape unreviewed.
          </p>
        </div>
      </section>
    </>
  );
}
