/**
 * Marketing Soft-UI previews — CSS recreation of real hub chrome.
 * Not screenshots; module names match PRODUCT_HUBS / island defaults.
 * No DEMO metrics.
 */

const hubs = [
  {
    id: "competition",
    title: "Competition",
    href: "/features",
    copy: "Command, My Day, Scouting, Strategy, Form builder, Match checklist, Pick clock.",
    tabs: ["Command", "My Day", "Strategy", "Scouting", "Form builder"],
    more: "Alliance Selection Desk · Pick clock",
    empty: "Link a TBA event to populate Command and My Day.",
  },
  {
    id: "team",
    title: "Team",
    href: "/for-teams",
    copy: "Calendar, todos, practice, attendance, knowledge — Season Planning in More.",
    tabs: ["Calendar", "Todos", "Practice", "Attendance", "Knowledge"],
    more: "Season Planning Workspace",
    empty: "Empty until your org calendar and goals are connected.",
  },
  {
    id: "business",
    title: "Business",
    href: "/for-teams",
    copy: "Budget, orders, sponsors, grants, partners, and award evidence.",
    tabs: ["Overview", "Budget", "Sponsors", "Grants", "Awards"],
    more: "Fundraisers · Community Impact",
    empty: "Pipelines stay empty until you add real sponsors and grants.",
  },
  {
    id: "build",
    title: "Build",
    href: "/features/cad",
    copy: "Kickoff, CAD agent, Code Coach, FMEA, prototypes, batteries.",
    tabs: ["Kickoff", "CAD", "Code", "FMEA", "Prototypes"],
    more: "Inspection readiness · Readiness score",
    empty: "CAD needs Onshape or Fusion OAuth before briefs run.",
  },
  {
    id: "ai",
    title: "AI",
    href: "/pricing",
    copy: "Assistant chat, budgets, writer, code assist — AI API keys in More.",
    tabs: ["Chat", "Budgets", "Writer", "Code assist", "Memory"],
    more: "AI API keys · Usage",
    empty: "Free teams add keys at /team/ai-keys. Paid plans add hosted routing.",
  },
] as const;

function SoftHubFrame({
  title,
  tabs,
  more,
  empty,
  activeTab = tabs[0],
}: {
  title: string;
  tabs: readonly string[];
  more: string;
  empty: string;
  activeTab?: string;
}) {
  return (
    <div className="soft-hub-frame" aria-hidden="true">
      <div className="soft-hub-frame-tabs">
        {tabs.map((tab) => (
          <span key={tab} className={tab === activeTab ? "is-active" : undefined}>
            {tab}
          </span>
        ))}
      </div>
      <div className="soft-hub-frame-body">
        <header>
          <strong>{title}</strong>
          <span>{activeTab}</span>
        </header>
        <p className="soft-hub-frame-empty">{empty}</p>
        <p className="soft-hub-frame-more">
          <em>More</em> {more}
        </p>
      </div>
    </div>
  );
}

export function ProductGlances() {
  return (
    <div className="product-glances product-glances-hubs" aria-label="Soft-UI product hubs">
      {hubs.map((hub) => (
        <article className="product-glance" key={hub.id}>
          <h3>
            <a href={hub.href}>{hub.title}</a>
          </h3>
          <p>{hub.copy}</p>
          <SoftHubFrame title={hub.title} tabs={hub.tabs} more={hub.more} empty={hub.empty} />
        </article>
      ))}
      <p className="product-glances-note">
        CSS recreation of Soft-UI hub chrome — not a live screenshot. Signed-in surfaces stay empty until TBA,
        scouts, or connectors provide real data.
      </p>
    </div>
  );
}

const islandApps = ["Home", "Compete", "Team", "Business"] as const;
const drawerPillars = ["Competition", "Team", "Logistics", "Business", "Build", "AI"] as const;
const competitionTabs = ["Command", "My Day", "Strategy", "Scouting", "Form builder", "Match checklist"] as const;

/** Hero Soft-UI shell — drawer + Competition hub + island, honest empty state. */
export function HeroProductVisual() {
  return (
    <div className="hero-soft-shell" aria-hidden="true">
      <div className="hero-soft-device">
        <header className="hero-soft-topbar">
          <span className="hero-soft-burger" aria-hidden="true">
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
            <p className="hero-soft-drawer-hint">Featured in More: Alliance desk · Season planning · AI keys</p>
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
                  <span>Season Planning Workspace</span>
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
      <p className="hero-soft-caption">Soft-UI Competition hub — structure matches the signed-in app; empty until real data.</p>
    </div>
  );
}
