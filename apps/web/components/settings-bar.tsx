"use client";

import { useMemo, useState } from "react";
import {
  activeSettingsId,
  visibleSettingsNav,
  type SettingsNavItem,
} from "../lib/nav/settings-nav";
import { withOrgHref } from "../lib/nav/product-nav";
import "./settings-bar.css";

type SettingsBarProps = {
  role: string | null | undefined;
  orgId?: string | null;
  pathname: string;
  activeTab?: string | null;
};

function chipHref(item: SettingsNavItem, orgId: string | null | undefined): string {
  return item.scope === "team" || item.id === "my-ai-keys"
    ? withOrgHref(item.href, orgId ?? null)
    : item.href;
}

export function SettingsBar({ role, orgId, pathname, activeTab }: SettingsBarProps) {
  const items = visibleSettingsNav(role);
  const search = activeTab ? `tab=${activeTab}` : "";
  const activeId = activeSettingsId(items, pathname, search);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (item: SettingsNavItem) =>
      !needle || item.label.toLowerCase().includes(needle);
    return [
      { id: "you", label: "You", items: items.filter((item) => item.scope === "personal" && match(item)) },
      { id: "team", label: "Team", items: items.filter((item) => item.scope === "team" && match(item)) },
    ].filter((group) => group.items.length > 0);
  }, [items, query]);

  return (
    <nav className="settings-bar tesla-settings" aria-label="Settings">
      <label className="settings-bar-search">
        <span className="visually-hidden">Search settings</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
        />
      </label>
      {groups.map((group) => (
        <div key={group.id} className="settings-bar-group" role="group" aria-label={`${group.label} settings`}>
          <span className="settings-bar-group-label">{group.label}</span>
          {group.items.map((item) => {
            const active = item.id === activeId;
            return (
              <a
                key={item.id}
                className={`settings-bar-row${active ? " is-active" : ""}`}
                href={chipHref(item, orgId)}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      ))}
      {groups.length === 0 ? <p className="settings-bar-empty">Nothing matches.</p> : null}
    </nav>
  );
}
