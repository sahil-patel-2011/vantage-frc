/**
 * Hero visual: a structure-only mock of Home for a new member's first week.
 * Illustrative UI, labelled as such — not a screenshot and not team data.
 */

const rail = ["Home", "Compete", "Team", "Build"] as const;

const today: readonly { label: string; value: string }[] = [
  { label: "What to do now", value: "Scout this match" },
  { label: "CAD", value: "Paste an Onshape link" },
  { label: "Match video", value: "Confirm the timeline" },
] as const;

export function HeroProductPanel() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-chrome">
        <span className="mk-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>Home · first week</strong>
        <b>Illustrative UI</b>
      </div>

      <div className="mk-mock-body">
        <div className="mk-mock-main">
          <article className="mk-mock-card">
            <header>
              <strong>Good evening</strong>
              <span>One login</span>
            </header>
            <dl className="mk-mock-rows">
              {today.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mk-mock-empty">
              Scouting, a CAD link, match video, and team ops — the same sign-in, nothing extra to install.
            </p>
          </article>
        </div>

        <div className="mk-mock-rail">
          {rail.map((item) => (
            <span className={item === "Home" ? "is-active" : undefined} key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <footer className="mk-mock-note">Structure only — a mock of the interface, not a screenshot and not team data.</footer>
    </div>
  );
}
