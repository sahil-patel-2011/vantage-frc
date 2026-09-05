/**
 * Marketing Soft-UI hero preview + hub directory.
 * Hub names match product pillars. No DEMO metrics or status chips.
 */

import {
  MARKETING_HUBS,
  MARKETING_WORKSPACES,
  marketingWorkspacesForHub,
} from "../../lib/marketing/product-story";

function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
          {/* Where to find it in the menu, so the page teaches the real chrome. */}
          <p className="mk-hub-where">Opens from {joinNames(marketingWorkspacesForHub(hub.id))}.</p>
        </article>
      ))}
    </div>
  );
}

/**
 * The mock is a picture of the shipped chrome, so both lists come from the
 * product nav: the drawer is Home plus the four workspaces, and the island is
 * those same four. Retyping them here is how the hero drifted into showing a
 * seven-pillar drawer that no longer exists.
 */
const workspaceNames = MARKETING_WORKSPACES.map((workspace) => workspace.title);
const drawerRows = ["Home", ...workspaceNames] as const;
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
                <small>Workspace</small>
              </div>
            </div>
            <nav>
              {drawerRows.map((row) => (
                <span key={row} className={row === "Compete" ? "is-active" : undefined}>
                  {row}
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
              <header>
                <strong>What this desk runs</strong>
                <span>Setup required</span>
              </header>
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
              <div className="hero-soft-empty">
                <b>Waiting on this team’s TBA event</b>
                <p>No DEMO schedule, EPA, or win rates. Connect the event and scout entries fill these rows.</p>
              </div>
            </div>
          </div>
        </div>

        <nav className="hero-soft-island">
          {workspaceNames.map((name) => (
            <span key={name} className={name === "Compete" ? "is-active" : undefined}>
              {name}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
