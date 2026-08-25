/**
 * Hero visual: a structure-only mock of the real product chrome — the hub rail,
 * the Competition tabs, a Command briefing card, and the Call Your Shot gate
 * (docs/AI_MENTOR_CONCEPT.md).
 *
 * Deliberately shows the honest empty state rather than invented numbers: the
 * briefing rows read "not connected" / "no entries yet", which is exactly what
 * the product renders before a team links an event. Nothing here is team data,
 * and there are no illustrative metrics to mistake for real ones.
 */

const rail = ["Home", "Competition", "Team", "Build", "Business", "AI"] as const;
const tabs = ["Command", "Scouting", "Strategy"] as const;

const briefing: readonly { label: string; value: string }[] = [
  { label: "Active event", value: "Not connected" },
  { label: "Next match", value: "Waiting on a schedule" },
  { label: "Scouting coverage", value: "No entries yet" },
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
        <strong>Competition · Command</strong>
        <b>Illustrative UI</b>
      </div>

      <div className="mk-mock-body">
        <aside className="mk-mock-rail">
          {rail.map((item) => (
            <span className={item === "Competition" ? "is-active" : undefined} key={item}>
              {item}
            </span>
          ))}
        </aside>

        <div className="mk-mock-main">
          <div className="mk-mock-tabs">
            {tabs.map((tab) => (
              <span className={tab === "Command" ? "is-active" : undefined} key={tab}>
                {tab}
              </span>
            ))}
          </div>

          <article className="mk-mock-card">
            <header>
              <strong>Match briefing</strong>
              <span>Setup required</span>
            </header>
            <dl className="mk-mock-rows">
              {briefing.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mk-mock-empty">
              Every surface stays empty until your team connects a real event. Vantage never fills these in with
              sample numbers.
            </p>
          </article>

          <div className="mk-mock-gate">
            <span className="mk-mock-gate-tag">Call your shot</span>
            <p>Before the gearbox calculator reveals output RPM — which term dominates at this reduction?</p>
            <div className="mk-mock-chips">
              <span>Free speed</span>
              <span className="is-picked">Stage ratio</span>
            </div>
            <em>Prediction locked · the team&rsquo;s own math grades it, not the model&rsquo;s opinion.</em>
          </div>
        </div>
      </div>

      <footer className="mk-mock-note">Structure only — a mock of the interface, not a screenshot and not team data.</footer>
    </div>
  );
}
