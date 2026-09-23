/**
 * Homepage product story. Real workspaces and tools that ship today.
 *
 * The home page carries one pass of the argument: the problem, the loop, three
 * real screens, the four workspaces, and how we work. The day-one path and the
 * season walk-through used to sit here too, but they are the whole point of
 * /for-teams and /workflow — repeating them made the phone scroll twice as long
 * for a reader who had already been convinced. Those pages still own that copy;
 * the hub section links to them.
 */

import {
  MARKETING_HELPERS,
  MARKETING_HUBS,
  MARKETING_LEARN,
  MARKETING_PROBLEMS,
  MARKETING_TRUST,
} from "../../lib/marketing/product-story";
import { MARKETING_APP_FRAMES, ProductFrame } from "./app-frames";
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

      <section className="lux-pillars mk-app-gallery" aria-labelledby="lux-app-frames">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">Vantage Scouting</p>
            <h2 id="lux-app-frames">What your scouting turns into.</h2>
            <p>
              Scouting is its own app for event days — scout, look up a team, plan a match, build the pick list —
              on the same sign-in and the same data as the rest of Vantage. These are drawings of its real screens:
              your event&rsquo;s numbers fill them in, and anything nobody scouted stays blank instead of guessed.
              Add it to a phone&rsquo;s home screen and it opens straight to Scouting, your next assigned robot on
              top; one tap before the venue
              saves every screen for a pit with no signal.
            </p>
          </header>
          <ul className="mk-app-gallery-grid" data-reveal>
            {MARKETING_APP_FRAMES.map((frame) => (
              <li key={frame.id}>
                <ProductFrame id={frame.id} />
                <strong>{frame.title}</strong>
                <span>{frame.copy}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lux-runs" aria-labelledby="lux-runs-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">One workspace</p>
            <h2 id="lux-runs-title">Four workspaces. Everything lives in one of them.</h2>
            <p>Team, Build, Competition and Business, with Home for what to do today. Search finds any tool by name.</p>
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
            <a href="/for-teams">Day one and the season</a>
            {" · "}
            <a href="/workflow">How it works</a>
            {" · "}
            <a href="/pricing">What it costs</a>
            {" · "}
            <a href="/signin">Sign in</a>
          </p>
        </div>
      </section>

      <section className="lux-fit" aria-labelledby="lux-trust-title">
        <div className="lux-content">
          <header className="lux-section-head" data-reveal>
            <p className="lux-eyebrow">How we work</p>
            <h2 id="lux-trust-title">Yours, offline-ready, and honest about what it knows.</h2>
            <p>Built by an FRC student, for FRC teams.</p>
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
