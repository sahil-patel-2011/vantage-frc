/**
 * Public Soft-UI frames of the signed-in app.
 * Hero uses the live Kickoff brief. Never invents scores, ratings, or team counts.
 */

import { computeGameBrief, gameBriefStatusBadge } from "../../lib/game-brief/compute-game-brief";

function AppChrome({ title, crumbs }: { title: string; crumbs: string }) {
  return (
    <div className="mk-mock-chrome">
      <span className="mk-mock-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>Vantage · {title}</strong>
      <b>{crumbs}</b>
    </div>
  );
}

function AppIsland({ island }: { island: "Home" | "Compete" | "Team" | "Build" }) {
  return (
    <nav className="mk-mock-rail" aria-hidden="true">
      {(["Home", "Compete", "Team", "Build"] as const).map((item) => (
        <span key={item} className={item === island ? "is-active" : undefined}>
          {item}
        </span>
      ))}
    </nav>
  );
}

/** Hero: Kickoff + Home — the screens a new member actually opens. */
export function HeroProductPanel() {
  const brief = computeGameBrief();
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-chrome">
        <span className="mk-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>Vantage · Kickoff</strong>
        <b>Build / Kickoff</b>
      </div>

      <div className="mk-mock-body">
        <div className="mk-mock-main">
          <div className="mk-mock-tabs">
            <span className="is-active">Kickoff</span>
            <span>Home</span>
          </div>
          <article className="mk-mock-card">
            <header>
              <strong>
                {brief.gameName} {brief.year}
              </strong>
              <span>{gameBriefStatusBadge(brief.status)}</span>
            </header>
            <p className="mk-mock-empty">{brief.headline}</p>
            {brief.priorSeason ? (
              <p className="mk-mock-empty">
                Last season you can study now — {brief.priorSeason.gameName} {brief.priorSeason.year}
              </p>
            ) : null}
            <p className="mk-mock-shot">
              <span className="mk-app-primary">Ask about this game</span>
            </p>
          </article>
          <article className="mk-mock-card">
            <header>
              <strong>What to do now</strong>
              <span>Home</span>
            </header>
            <dl className="mk-mock-rows">
              <div>
                <dt>Scout this match</dt>
                <dd>Needs setup</dd>
              </div>
              <div>
                <dt>Learn CAD</dt>
                <dd>CAD Video Tutor</dd>
              </div>
              <div>
                <dt>Ask AI</dt>
                <dd>Connect Claude Code</dd>
              </div>
            </dl>
          </article>
        </div>
        <div className="mk-mock-rail">
          {(["Home", "Compete", "Team", "Build"] as const).map((item) => (
            <span key={item} className={item === "Build" ? "is-active" : undefined}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <footer className="mk-mock-note">
        Interface preview — the real Kickoff brief, not a team&apos;s scores.
      </footer>
    </div>
  );
}

export type ProductFrameId = "lookup" | "predict" | "picklist";

/**
 * The three data screens, drawn as shapes. Bars and lines show how Vantage lays
 * scouting out; no frame carries a number, because any number here would be
 * one we made up. The caption under each frame says so.
 */
function Bars({ widths }: { widths: number[] }) {
  return (
    <span className="mk-shape-bars">
      {widths.map((width, index) => (
        <i key={index} style={{ width: `${width}%` }} />
      ))}
    </span>
  );
}

function Spark({ d }: { d: string }) {
  return (
    <svg className="mk-shape-spark" viewBox="0 0 72 24">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ProductFrame({ id }: { id: ProductFrameId }) {
  switch (id) {
    case "lookup":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Research" crumbs="Competition / Team lookup" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>Teams at your event</strong>
                  <span>Best first</span>
                </header>
                <ul className="mk-shape-roster">
                  {[92, 81, 74, 63, 55].map((width, index) => (
                    <li key={width}>
                      <b>{index + 1}</b>
                      <span className="mk-shape-bar">
                        <i style={{ width: `${width}%` }} />
                      </span>
                      <em>{index === 3 ? "not scouted" : "scouted"}</em>
                    </li>
                  ))}
                </ul>
              </article>
              <article className="mk-mock-card">
                <header>
                  <strong>From our scouting</strong>
                  <span>By match</span>
                </header>
                <div className="mk-shape-tiles">
                  <span>
                    Total points
                    <Spark d="M0 18 L12 14 L24 16 L36 9 L48 11 L60 5 L72 6" />
                  </span>
                  <span>
                    Auto
                    <Spark d="M0 12 L12 12 L24 10 L36 11 L48 8 L60 9 L72 7" />
                  </span>
                  <span>
                    Endgame
                    <Bars widths={[66, 26, 8]} />
                  </span>
                </div>
              </article>
            </div>
            <AppIsland island="Compete" />
          </div>
        </div>
      );
    case "predict":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Match Simulator" crumbs="Competition / Strategy" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>Chance to win</strong>
                  <span>Flip red / blue</span>
                </header>
                <span className="mk-shape-win">
                  <i className="is-red" />
                  <i className="is-blue" />
                </span>
                <div className="mk-shape-alliances">
                  <span className="is-red">
                    Red
                    <Bars widths={[88, 80, 76]} />
                  </span>
                  <span className="is-blue">
                    Blue
                    <Bars widths={[72, 68, 64]} />
                  </span>
                </div>
              </article>
              <article className="mk-mock-card">
                <header>
                  <strong>Where blue can close the gap</strong>
                  <span>Teleop</span>
                </header>
                <p className="mk-mock-empty">One lever, named by team and phase — from ratings, not a guess.</p>
              </article>
            </div>
            <AppIsland island="Compete" />
          </div>
        </div>
      );
    case "picklist":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Pick list" crumbs="Competition / Pick list" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>What matters to us</strong>
                  <span>Drag to weigh</span>
                </header>
                <ul className="mk-shape-sliders">
                  {[
                    ["Total points", 80],
                    ["Auto", 55],
                    ["Endgame", 70],
                    ["Reliability", 90],
                  ].map(([label, value]) => (
                    <li key={label as string}>
                      <span>{label}</span>
                      <span className="mk-shape-slider">
                        <i style={{ left: `${value}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
              <article className="mk-mock-card">
                <header>
                  <strong>Tiers</strong>
                  <span>Whole team votes</span>
                </header>
                <div className="mk-shape-tiers">
                  <span>First pick</span>
                  <span>Second pick</span>
                  <span>Do not pick</span>
                </div>
              </article>
            </div>
            <AppIsland island="Compete" />
          </div>
        </div>
      );
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export const MARKETING_APP_FRAMES: { id: ProductFrameId; title: string; copy: string }[] = [
  {
    id: "lookup",
    title: "Team lookup",
    copy: "Every team at the event, best first, with who your scouts have not watched yet. Tap one for its averages, a trend line per stat, and every scout note by match.",
  },
  {
    id: "predict",
    title: "Match prediction",
    copy: "Put any six robots on the field and see who is likely to win, each robot's share, and the one phase that would swing it. Flip red and blue in a tap.",
  },
  {
    id: "picklist",
    title: "Pick list",
    copy: "Slide what your alliance needs — scoring, auto, endgame, reliability — and the list re-ranks against this event. Then the whole team sorts it into tiers together.",
  },
];
