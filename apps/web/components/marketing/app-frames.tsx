/**
 * Public Soft-UI frames of the signed-in app.
 * The hero is an example Home layout. Never invents scores, ratings, or team counts.
 */


function AppChrome({ title, crumbs }: { title: string; crumbs: string }) {
  return (
    <div className="mk-mock-chrome">
      <span className="mk-mock-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {/* The screen's own name only: "Vantage · Res…" beside a breadcrumb pill clipped at desktop width. */}
      <strong>{title}</strong>
      <b>{crumbs}</b>
    </div>
  );
}

const PREVIEW_ISLAND = ["Home", "Matches", "Scout", "Stats"] as const;

function AppIsland({ island }: { island: (typeof PREVIEW_ISLAND)[number] }) {
  return (
    <nav className="mk-mock-rail" aria-hidden="true">
      {PREVIEW_ISLAND.map((item) => (
        <span key={item} className={item === island ? "is-active" : undefined}>
          {item}
        </span>
      ))}
    </nav>
  );
}

/**
 * Hero: Home on an event day, the screen a member opens most. An example layout with the
 * labels a team sees, and no scores, ratings or team numbers: the page never invents data
 * about real teams. (It used to open on next season's Kickoff brief, which reads "manual not
 * out" for most of the year.)
 */
export function HeroProductPanel() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-chrome">
        <span className="mk-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>Vantage · Home</strong>
        <b>Example screen</b>
      </div>

      <div className="mk-mock-body">
        <div className="mk-mock-main">
          {/* Drawn like the real Next match card (bumper pill, alliance chips, win bar, game plan)
              rather than a list of labels; roles stand in for team numbers and the bar has no
              figure, because any number here would be made up. */}
          <article className="mk-mock-card mk-hero-next">
            <header>
              <strong>Next match</strong>
              <span>Event day</span>
            </header>
            <div className="mk-hero-match">
              <b>Your next qual</b>
              <em>Queue soon</em>
            </div>
            <span className="mk-hero-bumper">Switch to blue bumpers</span>
            <div className="mk-hero-side is-us">
              <small>With us</small>
              <span>
                <i>Us</i>
                <i>Partner</i>
                <i>Partner</i>
              </span>
            </div>
            <div className="mk-hero-side is-them">
              <small>Against</small>
              <span>
                <i>Opponent</i>
                <i>Opponent</i>
                <i>Opponent</i>
              </span>
            </div>
            <span className="mk-hero-win" role="presentation">
              <i />
            </span>
            <p className="mk-hero-win-label">Chance we win, from your scouting</p>
            <p className="mk-hero-plan">
              <strong>Game plan</strong>
              <span>One partner defends their top scorer; we keep cycling.</span>
            </p>
          </article>
          <article className="mk-mock-card mk-hero-todo">
            <header>
              <strong>What to do now</strong>
              <span>For you</span>
            </header>
            <ul>
              <li>
                <span>
                  <strong>Scout the next open match</strong>
                  <small>Your next robot, one tap</small>
                </span>
                <b>Start</b>
              </li>
              <li>
                <span>
                  <strong>Pre-match briefing</strong>
                  <small>Their likely plan: cycles fast, goes for the endgame</small>
                </span>
                <b>Open</b>
              </li>
              <li>
                <span>
                  <strong>Pit TV</strong>
                  <small>Next match on the pit screen</small>
                </span>
                <b>Show</b>
              </li>
            </ul>
          </article>
        </div>
        <div className="mk-mock-rail">
          {PREVIEW_ISLAND.map((item) => (
            <span key={item} className={item === "Home" ? "is-active" : undefined}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <footer className="mk-mock-note">Example screen. Your team&apos;s real matches fill it in.</footer>
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
          <AppChrome title="Team lookup" crumbs="Competition" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>Teams at your event</strong>
                  <span>Best first</span>
                </header>
                <ul className="mk-shape-roster">
                  {/* What scouting says about each robot, in the words the app uses. */}
                  {(
                    [
                      [92, "cycles fast, goes for the endgame"],
                      [81, "strong auto, steady teleop"],
                      [74, "plays defense"],
                      [63, "not scouted yet"],
                      [55, "endgame is hit or miss"],
                    ] as const
                  ).map(([width, words], index) => (
                    <li key={width}>
                      <b>{index + 1}</b>
                      <span className="mk-shape-bar">
                        <i style={{ width: `${width}%` }} />
                      </span>
                      <em>{words}</em>
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
            <AppIsland island="Scout" />
          </div>
        </div>
      );
    case "predict":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Match prediction" crumbs="Competition" />
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
            <AppIsland island="Matches" />
          </div>
        </div>
      );
    case "picklist":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Pick list" crumbs="Competition" />
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
            <AppIsland island="Stats" />
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
