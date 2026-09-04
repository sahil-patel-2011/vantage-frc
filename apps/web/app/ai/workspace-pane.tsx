"use client";

import { useMemo, useState, type ReactNode } from "react";
import "./workspace-pane.css";

export type WorkspacePaneItem = {
  id: string;
  label: string;
  hint?: string;
};

export type WorkspacePaneGroup = {
  id: string;
  label: string;
  items: WorkspacePaneItem[];
};

export function WorkspacePane({
  groups,
  value,
  onChange,
  searchPlaceholder = "Search",
  children,
}: {
  groups: WorkspacePaneGroup[];
  value: string;
  onChange: (id: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  return (
    <div className="tesla-pane">
      <aside className="tesla-pane-nav" aria-label="Sections">
        <label className="tesla-pane-search">
          <span className="visually-hidden">{searchPlaceholder}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        {filtered.map((group) => (
          <div key={group.id} className="tesla-pane-group" role="group" aria-label={group.label}>
            <span className="tesla-pane-group-label">{group.label}</span>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === value ? "is-active" : undefined}
                aria-current={item.id === value ? "page" : undefined}
                onClick={() => onChange(item.id)}
              >
                <strong>{item.label}</strong>
                {item.hint ? <small>{item.hint}</small> : null}
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 ? <p className="tesla-pane-empty">Nothing matches.</p> : null}
      </aside>
      <div className="tesla-pane-body">{children}</div>
    </div>
  );
}
