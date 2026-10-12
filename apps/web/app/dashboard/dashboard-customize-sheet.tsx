"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/icon";
import { WIDGET_SIZE_KEYS, type DashboardWidgetType, type WidgetSizeKey } from "../../lib/dashboard/catalog";
import { groupWidgetRows, HIDDEN_ON_HOME_COPY, type HiddenOnHomeReason } from "../../lib/dashboard/edit-mode";
import type { PaletteRow } from "./dashboard-board-types";
import "./dashboard-customize.css";

/*
  Edit Home, as one panel and plain controls.

  Editing used to happen on the board itself: grid lines, a drag handle and a "Size" menu on
  every card, dimmed cards for the ones Home was hiding, a floating toolbar, and a second sheet
  for adding widgets. Every card carried four controls and a mis-aimed drag was the most common
  way to "break" Home. Now the board behind this panel is a live preview with no controls on it,
  and everything you can change is a row here:

    On Home      every card, in the order Home shows them: a Size dropdown, Move up / Move down,
                 Remove. Cards that show up on their own say so and can be set to always show.
    Add widgets  the catalogue, grouped and searchable, one tap to add.

  Cancel (left) puts everything back; Done (right) saves. Undo is beside Cancel; the occasional
  things (tidy, preview, save for the team, reset) are quiet links at the end of the list.
*/

export type CustomizeRow = {
  id: string;
  type: DashboardWidgetType;
  label: string;
  icon: IconName;
  size: WidgetSizeKey;
  /** Home is leaving this card out right now, and why. Null when it shows. */
  hiddenReason: HiddenOnHomeReason | null;
  alwaysShown: boolean;
};

const SIZE_NAMES: Record<WidgetSizeKey, string> = { s: "Small", m: "Medium", l: "Large", xl: "Full width" };

export function DashboardCustomizeSheet({
  rows,
  hiddenRows,
  paletteRows,
  paletteIcon,
  waiting,
  showSizes,
  tab,
  saving,
  canUndo,
  canShareOrg,
  onTab,
  onAdd,
  onRemove,
  onResize,
  onMove,
  onAlwaysShow,
  onTidy,
  onPreview,
  onSaveOrg,
  onReset,
  onUndo,
  onCancel,
  onDone,
}: {
  rows: CustomizeRow[];
  hiddenRows: CustomizeRow[];
  paletteRows: PaletteRow[];
  paletteIcon: (type: DashboardWidgetType) => IconName;
  /** The team or role is not known yet: the catalogue would say Locked from missing data. */
  waiting: boolean;
  /** One column (a phone): every size is full width, so there is nothing to choose. */
  showSizes: boolean;
  tab: "home" | "add";
  saving: boolean;
  canUndo: boolean;
  canShareOrg: boolean;
  onTab: (tab: "home" | "add") => void;
  onAdd: (type: DashboardWidgetType) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSizeKey) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onAlwaysShow: (id: string, always: boolean) => void;
  onTidy: () => void;
  onPreview: () => void;
  onSaveOrg: () => void;
  onReset: () => void;
  onUndo: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupWidgetRows(paletteRows, query), [paletteRows, query]);
  const addableCount = paletteRows.filter((row) => row.status === "add").length;

  // Focus moves into the panel when it opens, so keyboard and screen-reader users start here.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  // The search box takes focus only where there is a real keyboard: a phone keyboard popping up
  // over the list is not what "Add widgets" asked for.
  useEffect(() => {
    if (tab !== "add") return;
    if (!window.matchMedia("(pointer: coarse)").matches) searchRef.current?.focus();
  }, [tab]);

  return (
    <aside
      ref={panelRef}
      className="dash-customize"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="dash-customize-sheet"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (tab === "add") onTab("home");
        else onCancel();
      }}
    >
      <header className="dash-customize-head">
        <h2 id={titleId}>Edit Home</h2>
        <div className="dash-customize-tabs" role="tablist" aria-label="Edit Home">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "home"}
            aria-controls="dash-customize-home"
            data-testid="dash-customize-tab-home"
            onClick={() => onTab("home")}
          >
            On Home <span className="dash-customize-count">{rows.length + hiddenRows.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "add"}
            aria-controls="dash-widget-sheet"
            data-testid="dash-open-library"
            onClick={() => onTab("add")}
          >
            Add widgets
          </button>
        </div>
      </header>

      <div className="dash-customize-body">
        {tab === "home" ? (
          <section id="dash-customize-home" role="tabpanel" aria-label="On Home">
            {rows.length === 0 && hiddenRows.length === 0 ? (
              <div className="dash-customize-empty">
                <p>Home has no cards yet.</p>
                <button type="button" className="dash-customize-link" onClick={() => onTab("add")}>
                  Add a widget
                </button>
              </div>
            ) : null}
            {rows.length ? (
              <ol className="dash-customize-list" aria-label="Cards on Home, in order">
                {rows.map((row, index) => (
                  <li key={row.id} data-testid="dash-customize-row" data-widget-type={row.type}>
                    <i className="dash-customize-icon" aria-hidden="true">
                      <Icon name={row.icon} />
                    </i>
                    <span className="dash-customize-name">
                      <strong>{row.label}</strong>
                      {/* Home leaves an empty card out until it has something to show; say so
                          here, or moving it seems to do nothing. */}
                      {row.hiddenReason && !row.alwaysShown ? (
                        <small>
                          {HIDDEN_ON_HOME_COPY[row.hiddenReason]} ·{" "}
                          <button type="button" className="dash-customize-inline" disabled={saving} onClick={() => onAlwaysShow(row.id, true)}>
                            Always show
                          </button>
                        </small>
                      ) : null}
                    </span>
                    {showSizes ? (
                      <label className="dash-customize-size">
                        <span className="sr-only">Size of {row.label}</span>
                        <select
                          value={row.size}
                          disabled={saving}
                          data-testid="dash-customize-size"
                          onChange={(event) => onResize(row.id, event.target.value as WidgetSizeKey)}
                        >
                          {WIDGET_SIZE_KEYS.map((size) => (
                            <option key={size} value={size}>
                              {SIZE_NAMES[size]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <span className="dash-customize-actions">
                      <button
                        type="button"
                        className="dash-customize-icon-btn"
                        aria-label={`Move ${row.label} up`}
                        title="Move up"
                        disabled={saving || index === 0}
                        onClick={() => onMove(row.id, "up")}
                      >
                        <Icon name="chevron" className="is-up" />
                      </button>
                      <button
                        type="button"
                        className="dash-customize-icon-btn"
                        aria-label={`Move ${row.label} down`}
                        title="Move down"
                        disabled={saving || index === rows.length - 1}
                        onClick={() => onMove(row.id, "down")}
                      >
                        <Icon name="chevron" className="is-down" />
                      </button>
                      <button
                        type="button"
                        className="dash-customize-icon-btn is-remove"
                        aria-label={`Remove ${row.label} from Home`}
                        title="Remove"
                        disabled={saving}
                        onClick={() => onRemove(row.id)}
                      >
                        <span aria-hidden="true" className="dash-customize-minus" />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}

            {hiddenRows.length ? (
              <>
                <h3 className="dash-customize-sub">Shows up on its own</h3>
                <p className="dash-customize-note">These stay on Home and appear when they have something to show.</p>
                <ul className="dash-customize-list is-quiet">
                  {hiddenRows.map((row) => (
                    <li key={row.id} data-testid="dash-customize-hidden-row" data-widget-type={row.type}>
                      <i className="dash-customize-icon" aria-hidden="true">
                        <Icon name={row.icon} />
                      </i>
                      <span className="dash-customize-name">
                        <strong>{row.label}</strong>
                        {row.hiddenReason ? <small>{HIDDEN_ON_HOME_COPY[row.hiddenReason]}</small> : null}
                      </span>
                      <span className="dash-customize-actions">
                        <button
                          type="button"
                          className="dash-customize-link"
                          disabled={saving}
                          onClick={() => onAlwaysShow(row.id, true)}
                        >
                          Always show
                        </button>
                        <button
                          type="button"
                          className="dash-customize-icon-btn is-remove"
                          aria-label={`Remove ${row.label} from Home`}
                          title="Remove"
                          disabled={saving}
                          onClick={() => onRemove(row.id)}
                        >
                          <span aria-hidden="true" className="dash-customize-minus" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="dash-customize-more" aria-label="More options">
              <button type="button" className="dash-customize-link" data-testid="dash-tidy" disabled={saving} onClick={onTidy}>
                Close up gaps
              </button>
              <button type="button" className="dash-customize-link" data-testid="dash-preview" onClick={onPreview}>
                Preview
              </button>
              {canShareOrg ? (
                <button type="button" className="dash-customize-link" data-testid="dash-save-team" disabled={saving} onClick={onSaveOrg}>
                  Save for team
                </button>
              ) : null}
              <button
                type="button"
                className="dash-customize-link is-danger"
                data-testid="dash-reset-board"
                disabled={saving}
                onClick={onReset}
              >
                Reset to default
              </button>
            </div>
          </section>
        ) : (
          <section id="dash-widget-sheet" role="tabpanel" aria-label="Add widgets" data-testid="dash-widget-sheet">
            <label className="dash-customize-search">
              <Icon name="search" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Search widgets"
                aria-label="Search widgets"
                data-testid="dash-widget-search"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {waiting ? <p className="dash-customize-note" role="status">Loading your team…</p> : null}
            {!waiting && addableCount === 0 && !query ? (
              <p className="dash-customize-note">Every widget you can use is already on Home.</p>
            ) : null}
            {!waiting && groups.length === 0 ? <p className="dash-customize-note">No widgets match “{query.trim()}”.</p> : null}
            {(waiting ? [] : groups).map((group) => (
              <section key={group.group} aria-label={group.label} className="dash-customize-group">
                <h3 className="dash-customize-sub">{group.label}</h3>
                <ul className="dash-customize-list">
                  {group.rows.map(({ entry, status, reason, placedLabel }) => {
                    const addable = status === "add";
                    return (
                      <li key={entry.type}>
                        <i className="dash-customize-icon" aria-hidden="true">
                          <Icon name={paletteIcon(entry.type)} />
                        </i>
                        <span className="dash-customize-name">
                          <strong>{entry.label}</strong>
                          <small>{status === "locked" && reason ? reason : entry.description}</small>
                        </span>
                        {addable ? (
                          <button
                            type="button"
                            className="dash-customize-add"
                            data-testid={`dash-library-${entry.type}`}
                            aria-label={`Add ${entry.label}`}
                            disabled={saving}
                            onClick={() => onAdd(entry.type)}
                          >
                            <span aria-hidden="true">+</span> Add
                          </button>
                        ) : (
                          <span className="dash-customize-state">{status === "placed" ? placedLabel ?? "On Home" : "Locked"}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </section>
        )}
      </div>

      <footer className="dash-customize-foot" role="toolbar" aria-label="Edit Home" data-testid="dash-edit-toolbar">
        <button type="button" className="dash-customize-btn" data-testid="dash-edit-cancel" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="dash-customize-btn is-icon"
          data-testid="dash-undo"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={saving || !canUndo}
          onClick={onUndo}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="dash-customize-spacer" />
        <button type="button" className="dash-customize-btn is-primary" data-testid="dash-edit-done" disabled={saving} onClick={onDone}>
          {saving ? "Saving…" : "Done"}
        </button>
      </footer>
    </aside>
  );
}
