/**
 * Marketing Soft-UI hero preview + hub directory.
 * Hub names match product pillars. No DEMO metrics or status chips.
 */

import { MARKETING_HUBS } from "../../lib/marketing/product-story";

/** Hub directory used on /features. */
export function ProductGlances() {
  return (
    <div className="product-glances product-glances-hubs" aria-label="Product hubs">
      {MARKETING_HUBS.map((hub) => (
        <article className="product-glance" key={hub.id} id={hub.id}>
          <h3>
            <a href={`#${hub.id}-detail`}>{hub.title}</a>
          </h3>
          <p>{hub.promise}</p>
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

export function ProductHubCatalog() {
  return (
    <div className="mk-hub-catalog">
      {MARKETING_HUBS.map((hub) => (
        <article className="mk-hub-detail" id={`${hub.id}-detail`} key={hub.id}>
          <header>
            <p className="lux-kicker">{hub.route}</p>
            <h3 id={hub.id}>{hub.title}</h3>
            <p>{hub.promise}</p>
          </header>
          <ul>
            {hub.tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

const islandApps = ["Home", "Compete", "Team", "Business"] as const;
const drawerPillars = ["Competition", "Team", "Logistics", "Business", "Media", "Build", "AI"] as const;
const competitionTabs = ["Event day", "Scouting", "Strategy", "Pit"] as const;

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
            <small>Active event from TBA</small>
          </div>
          <span className="hero-soft-avatar">V</span>
        </header>

        <div className="hero-soft-body">
          <aside className="hero-soft-drawer">
            <div className="hero-soft-drawer-brand">
              <span className="hero-soft-mark">v</span>
              <div>
                <strong>Vantage</strong>
                <small>Your team</small>
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
                <span key={tab} className={tab === "Event day" ? "is-active" : undefined}>
                  {tab}
                </span>
              ))}
            </div>
            <div className="hero-soft-panel hero-soft-board">
              <ul className="hero-soft-cues">
                <li>
                  <b>Event day</b>
                  <span>Next match · pit queue · checklist</span>
                </li>
                <li>
                  <b>Scouting</b>
                  <span>Offline forms · QR · pit mesh</span>
                </li>
                <li>
                  <b>Strategy</b>
                  <span>Alliance desk · pick clock</span>
                </li>
                <li>
                  <b>Pit</b>
                  <span>Repair triage · batteries</span>
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
        </nav>
      </div>
    </div>
  );
}
