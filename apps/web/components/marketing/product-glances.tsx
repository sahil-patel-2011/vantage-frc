/**
 * Marketing hub directory + hero Soft-UI preview.
 * Hub names and tabs match PRODUCT_HUBS / island defaults. No DEMO metrics.
 */

const hubs = [
  {
    id: "competition",
    title: "Competition",
    href: "/features",
    modules: [
      "Command",
      "My Day",
      "Scouting",
      "Strategy",
      "Form builder",
      "Match checklist",
      "Pick clock",
      "Alliance Selection Desk",
    ],
  },
  {
    id: "team",
    title: "Team",
    href: "/for-teams",
    modules: ["Calendar", "Todos", "Practice", "Attendance", "Knowledge", "Season Planning Workspace"],
  },
  {
    id: "business",
    title: "Business",
    href: "/for-teams",
    modules: ["Budget", "Orders", "Sponsors", "Grants", "Partners", "Award evidence"],
  },
  {
    id: "build",
    title: "Build",
    href: "/features/cad",
    modules: ["Kickoff", "CAD agent", "Code Coach", "FMEA", "Prototypes", "Batteries"],
  },
  {
    id: "ai",
    title: "AI",
    href: "/pricing",
    modules: ["Assistant chat", "Writer", "Budgets", "Code assist", "AI API keys"],
  },
] as const;

export function ProductGlances() {
  return (
    <div className="product-glances product-glances-hubs" aria-label="Product hubs">
      {hubs.map((hub) => (
        <article className="product-glance" key={hub.id}>
          <h3>
            <a href={hub.href}>{hub.title}</a>
          </h3>
          <ul className="product-glance-modules">
            {hub.modules.map((mod) => (
              <li key={mod}>{mod}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

const islandApps = ["Home", "Compete", "Team", "Business"] as const;
const drawerPillars = ["Competition", "Team", "Logistics", "Business", "Build", "AI"] as const;
const competitionTabs = ["Command", "My Day", "Strategy", "Scouting", "Form builder"] as const;

/** Hero Soft-UI shell — drawer + Competition hub + island, honest empty state. */
export function HeroProductVisual() {
  return (
    <div className="hero-soft-shell" aria-hidden="true">
      <div className="hero-soft-device">
        <header className="hero-soft-topbar">
          <span className="hero-soft-burger">
            <i />
            <i />
            <i />
          </span>
          <div className="hero-soft-topbar-title">
            <strong>Competition</strong>
            <small>Command</small>
          </div>
          <span className="hero-soft-avatar">V</span>
        </header>

        <div className="hero-soft-body">
          <aside className="hero-soft-drawer">
            <div className="hero-soft-drawer-brand">
              <span className="hero-soft-mark">v</span>
              <div>
                <strong>Vantage</strong>
                <small>Navigation</small>
              </div>
            </div>
            <nav>
              {drawerPillars.map((pillar) => (
                <span key={pillar} className={pillar === "Competition" ? "is-active" : undefined}>
                  {pillar}
                </span>
              ))}
            </nav>
          </aside>

          <div className="hero-soft-main">
            <div className="hero-soft-tabs">
              {competitionTabs.map((tab) => (
                <span key={tab} className={tab === "Command" ? "is-active" : undefined}>
                  {tab}
                </span>
              ))}
            </div>
            <div className="hero-soft-panel">
              <header>
                <strong>Command</strong>
                <span>Event day</span>
              </header>
              <div className="hero-soft-empty">
                <b>No event linked</b>
                <p>Connect TBA for this org to populate next match, pit tasks, and My Day.</p>
              </div>
              <ul className="hero-soft-pins">
                <li>
                  <span>Alliance Selection Desk</span>
                  <em>More</em>
                </li>
                <li>
                  <span>Season Planning</span>
                  <em>Team · More</em>
                </li>
                <li>
                  <span>AI API keys</span>
                  <em>/team/ai-keys</em>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <nav className="hero-soft-island">
          {islandApps.map((app) => (
            <span key={app} className={app === "Compete" ? "is-active" : undefined}>
              {app}
            </span>
          ))}
          <span className="hero-soft-island-more">More</span>
        </nav>
      </div>
    </div>
  );
}
