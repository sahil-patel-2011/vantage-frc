import { withOrgHref } from "../lib/nav/product-nav";
import { TEAM_SETTINGS_PAGES, type TeamSettingsPageId } from "../lib/nav/team-settings-nav";
import "./team-settings-nav.css";

/** One chip row, the same on every team settings page, with the page you are on marked. */
export function TeamSettingsNav({ orgId, current }: { orgId: string | null | undefined; current: TeamSettingsPageId }) {
  return (
    <nav className="team-settings-nav" aria-label="Team settings">
      {TEAM_SETTINGS_PAGES.map((page) => (
        <a
          key={page.id}
          href={withOrgHref(page.href, orgId ?? null)}
          aria-current={page.id === current ? "page" : undefined}
          className={page.id === current ? "is-current" : undefined}
        >
          {page.label}
        </a>
      ))}
    </nav>
  );
}
