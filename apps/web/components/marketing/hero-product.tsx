/**
 * Hero visual: a structure-only mock of Home for a new member's first week.
 * Illustrative UI, labelled as such — not a screenshot and not team data.
 */

const rail = ["Home", "Compete", "Team", "Build"] as const;
const tabs = ["Today", "Learn", "Files", "Ask AI"] as const;

const today: readonly { label: string; value: string }[] = [
  { label: "Next meeting", value: "Tue 6 pm · build night" },
  { label: "Due this week", value: "2 tasks · 1 part request" },
  { label: "Learn CAD", value: "Lesson 5 of 14 · Name things" },
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
          <div className="mk-mock-tabs">
            {tabs.map((tab) => (
              <span className={tab === "Today" ? "is-active" : undefined} key={tab}>
                {tab}
              </span>
            ))}
          </div>

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
              Calendar, tasks, files, chat, the learning track and the team&rsquo;s own docs — all here, nothing to
              install and no second account.
            </p>
          </article>

          <div className="hero-teach-shot mk-mock-shot">
            <span className="hero-teach-shot-tag">Ask AI</span>
            <p>Strategy, match predictions, design help, writing — from your team&rsquo;s own data and the public record.</p>
            <div className="hero-teach-chips">
              <span>Predict our next match</span>
              <span className="is-picked">Find a time for mechanical</span>
            </div>
            <em>It shows what it used, and says plainly when there is not enough to answer.</em>
          </div>
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
