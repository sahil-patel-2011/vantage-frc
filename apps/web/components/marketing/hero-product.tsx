/**
 * Hero visual: structure-only mock of Competition chrome.
 * Honest empty states — never invented match lists, EPA, or win rates.
 */

const rail = ["Home", "Competition", "Team", "Build", "Business", "AI"] as const;
const tabs = ["Event day", "Scouting", "Strategy", "Pit"] as const;

const briefing: readonly { label: string; value: string }[] = [
  { label: "Active event", value: "Not connected" },
  { label: "Next match", value: "Waiting on TBA" },
  { label: "Scouting", value: "No entries yet" },
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
        <strong>Competition · Event day</strong>
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
              <span className={tab === "Event day" ? "is-active" : undefined} key={tab}>
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
              Event day, My Day, and checklists stay empty until this team’s TBA schedule is connected.
            </p>
          </article>

          <div className="hero-teach-shot mk-mock-shot">
            <span className="hero-teach-shot-tag">At the venue</span>
            <p>Offline match and pit forms, QR handoff, and pit mesh — then sync when Wi-Fi returns.</p>
            <div className="hero-teach-chips">
              <span>Offline forms</span>
              <span className="is-picked">Alliance desk</span>
            </div>
            <em>Strategy tools stay blank until scout entries and the public cache exist. No DEMO EPA.</em>
          </div>
        </div>
      </div>

      <footer className="mk-mock-note">Structure only — a mock of the interface, not a screenshot and not team data.</footer>
    </div>
  );
}
