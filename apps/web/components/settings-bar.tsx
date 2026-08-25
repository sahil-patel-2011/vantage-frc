"use client";

/**
 * One horizontal map of every settings surface — Personal chips, then Team
 * chips for owners/admins. Rendered at the top of settings pages so "where do
 * I change X" always has an answer on screen.
 *
 * Fetches nothing: the mounting page passes the role it already loaded.
 */

import { Icon } from "./app-shell";
import {
  activeSettingsId,
  visibleSettingsNav,
  type SettingsNavItem,
} from "../lib/nav/settings-nav";
import { withOrgHref } from "../lib/nav/product-nav";
import "./settings-bar.css";

type SettingsBarProps = {
  /** Raw org role from the page's own data ("owner" | "admin" | "scout" | …, or null). */
  role: string | null | undefined;
  /** Active workspace, so team links keep their ?orgId= context. */
  orgId?: string | null;
  /** Current route path, e.g. "/account". */
  pathname: string;
  /**
   * Current ?tab= value when the page manages tabs client-side (the /account
   * tabs use history.replaceState, so the mount passes its live tab state).
   */
  activeTab?: string | null;
};

function chipHref(item: SettingsNavItem, orgId: string | null | undefined): string {
  return item.scope === "team" || item.id === "my-ai-keys"
    ? withOrgHref(item.href, orgId ?? null)
    : item.href;
}

function ChipGroup({
  label,
  items,
  activeId,
  orgId,
}: {
  label: string;
  items: SettingsNavItem[];
  activeId: string | null;
  orgId: string | null | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <div className="settings-bar-group" role="group" aria-label={`${label} settings`}>
      <span className="settings-bar-group-label" aria-hidden>
        {label}
      </span>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            className={`settings-bar-chip${active ? " is-active" : ""}`}
            href={chipHref(item, orgId)}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </div>
  );
}

export function SettingsBar({ role, orgId, pathname, activeTab }: SettingsBarProps) {
  const items = visibleSettingsNav(role);
  const search = activeTab ? `tab=${activeTab}` : "";
  const activeId = activeSettingsId(items, pathname, search);
  const personal = items.filter((item) => item.scope === "personal");
  const team = items.filter((item) => item.scope === "team");

  return (
    <nav className="settings-bar" aria-label="All settings">
      <div className="settings-bar-scroll">
        <ChipGroup label="Personal" items={personal} activeId={activeId} orgId={orgId} />
        <ChipGroup label="Team" items={team} activeId={activeId} orgId={orgId} />
      </div>
    </nav>
  );
}
