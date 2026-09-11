/**
 * Homepage product story. Real workspaces and tools that ship today.
 */

import {
  MARKETING_HELPERS,
  MARKETING_HUBS,
  MARKETING_LEARN,
  MARKETING_PROBLEMS,
  MARKETING_SEASON,
  MARKETING_STUDENT_PATH,
  MARKETING_TRUST,
} from "../../lib/marketing/product-story";
import { MIcon } from "./marketing-icons";

export function HomeShowcase() {
  return (
    <>
      <section className="lux-problem" aria-labelledby="lux-problem-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">The problem</p>
            <h2 id="lux-problem-title">A team&rsquo;s season lives in ten apps that forget.</h2>
            <p>Every mentor already knows this. Here it is said plainly.</p>
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
            None of that is fixed by trying harder. It is what happens when the team&rsquo;s knowledge has no home
            and every new member starts from zero.
          </p>
        </div>
      </section>

      <section className="lux-loop" id="how-it-works" aria-labelledby="lux-loop-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">How it works</p>
            <h2 id="lux-loop-title">Learn. Build. Run the team. Compete.</h2>
            <p>One login for every student and mentor, and it teaches new members on the way in.</p>
          </header>
          <ol className="lux-loop-steps lux-loop-steps-4" data-reveal>
            {MARKETING_LEARN.map((item) => (
              <li key={item.step}>
                <b aria-hidden="true">{item.step}</b>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lux-pillars" aria-labelledby="lux-student-path">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">What you open first</p>
            <h2 id="lux-student-path">Four things a student can do on day one.</h2>
            <p>No extra accounts. Mentors invite you; then this is the path.</p>
          </header>
          <ul className="lux-feature-grid lux-feature-grid-4" data-reveal>
            {MARKETING_STUDENT_PATH.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lux-runs" aria-labelledby="lux-runs-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">One workspace</p>
            <h2 id="lux-runs-title">Four places. Everything is inside one of them.</h2>
            <p>Team, Build, Competition and Business — plus Home. Search finds the rest.</p>
          </header>
          <ul className="mk-pillars" data-reveal>
            {MARKETING_HUBS.map((hub) => (
              <li key={hub.id}>
                <a className="mk-pillar-link" href={hub.href}>
                  <span className="lux-card-icon">
                    <MIcon name={hub.icon} />
                  </span>
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
          <ul className="lux-feature-grid mk-helpers" data-reveal>
            {MARKETING_HELPERS.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </li>
            ))}
          </ul>
          <p className="mk-related-links" data-reveal>
            Deep dives: <a href="/features">Every tool</a>
            {" · "}
            <a href="/workflow">How it works</a>
            {" · "}
            <a href="/pricing">Pricing</a>
            {" · "}
            <a href="/signin">Sign in</a>
          </p>
        </div>
      </section>

      <section className="lux-loop" aria-labelledby="lux-season-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">The season</p>
            <h2 id="lux-season-title">All of it, not just the six weekends.</h2>
            <p>Competition is a few weekends. The other forty weeks are where a team is actually made.</p>
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
            <p className="lux-eyebrow">How we work</p>
            <h2 id="lux-trust-title">Yours, offline-ready, and honest about what it knows.</h2>
            <p>Built by an FRC student for FRC teams. Free to start, and we may open the source for other teams.</p>
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
        </div>
      </section>
    </>
  );
}
