/**
 * Marketing Soft-UI hero preview + optional hub directory for /features.
 * Hub names match Soft-UI pillars. No DEMO metrics or status chips.
 */

const hubs = [
  {
    id: "competition",
    title: "Competition",
    href: "/features",
    modules: ["Command", "Scouting", "Strategy"],
  },
  {
    id: "team",
    title: "Team",
    href: "/for-teams",
    modules: ["Calendar", "Team chat", "Todos"],
  },
  {
    id: "business",
    title: "Business",
    href: "/pricing",
    modules: ["Budget", "Sponsors", "Orders"],
  },
  {
    id: "build",
    title: "Build",
    href: "/features/cad",
    modules: ["Kickoff", "CAD", "Code"],
  },
  {
    id: "ai",
    title: "AI",
    href: "/pricing",
    modules: ["Chat", "Writer", "API keys"],
  },
  {
    id: "media",
    title: "Media",
    href: "/for-teams",
    modules: ["Calendar", "Drafts", "Media kit"],
  },
] as const;

/** Hub directory used on /features — not on the homepage (homepage uses a quieter strip). */
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
const competitionTabs = ["Command", "Scouting", "Strategy"] as const;

/** Hero chrome — labeled product areas, no invented match or scores. */
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
            <small>Your team</small>
          </div>
          <span className="hero-soft-avatar">V</span>
        </header>

        <div className="hero-soft-body">
          <aside className="hero-soft-drawer">
            <div className="hero-soft-drawer-brand">
              <span className="hero-soft-mark">v</span>
              <div>
                <strong>Vantage</strong>
                <small>Workspace</small>
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
            <div className="hero-soft-panel hero-soft-board">
              <ul className="hero-soft-cues">
                <li>
                  <b>Scout</b>
                  <span>Match and pit forms · offline</span>
                </li>
                <li>
                  <b>Event day</b>
                  <span>Next match and pit cues</span>
                </li>
                <li>
                  <b>Strategy</b>
                  <span>Picks from your scout data</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <nav className="hero-soft-island">
          {islandApps.map((app) => (
            <span key={app} className={app === "Home" ? "is-active" : undefined}>
              {app}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
