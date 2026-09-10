"use client";

import type { PointerEvent } from "react";
import { Icon } from "./icon";
import { ISLAND_TAB_CATALOG, withOrgHref, type IslandTabDefinition } from "../lib/nav/product-nav";

export function AppShellEventFocus({
  eventFocus,
  focusCollapsed,
  onCollapse,
  onExpand,
}: {
  eventFocus: {
    title: string;
    detail: string;
    freshness: string;
    tone: string;
    actions: Array<{ label: string; href: string; emphasis: string }>;
  };
  focusCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  if (focusCollapsed) {
    return (
      <button
        className={`soft-focus-reopen ${eventFocus.tone}`}
        type="button"
        onClick={onExpand}
        aria-label={`Show event focus: ${eventFocus.title}`}
      >
        <span /> {eventFocus.title}
      </button>
    );
  }
  return (
    <section className={`soft-focus-rail ${eventFocus.tone}`} aria-label="Event focus" aria-live="polite">
      <span className="soft-focus-signal" aria-hidden="true" />
      <div className="soft-focus-copy">
        <strong>{eventFocus.title}</strong>
        <span>{eventFocus.detail}</span>
      </div>
      <small>{eventFocus.freshness}</small>
      <nav aria-label="Next match actions">
        {eventFocus.actions.map((action) => (
          <a className={action.emphasis} href={action.href} key={action.label}>{action.label}</a>
        ))}
      </nav>
      <button
        className="soft-focus-collapse"
        type="button"
        onClick={onCollapse}
        aria-label="Collapse event focus"
      >
        ×
      </button>
    </section>
  );
}

export function AppShellIsland({
  orgId,
  islandTabs,
  activeIslandTabHref,
  unreadMessages,
  navOpen,
  onOpenNav,
  onOpenEditor,
  islandPressTimer,
  islandPressOrigin,
  islandLongPressed,
}: {
  orgId: string;
  islandTabs: IslandTabDefinition[];
  activeIslandTabHref: string | undefined;
  unreadMessages: number;
  navOpen: boolean;
  onOpenNav: () => void;
  onOpenEditor: () => void;
  islandPressTimer: { current: number | null };
  islandPressOrigin: { current: { x: number; y: number } | null };
  islandLongPressed: { current: boolean };
}) {
  function clearIslandPress() {
    if (islandPressTimer.current !== null) {
      window.clearTimeout(islandPressTimer.current);
      islandPressTimer.current = null;
    }
    islandPressOrigin.current = null;
  }

  function startIslandPress(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearIslandPress();
    islandLongPressed.current = false;
    islandPressOrigin.current = { x: event.clientX, y: event.clientY };
    islandPressTimer.current = window.setTimeout(() => {
      islandPressTimer.current = null;
      islandPressOrigin.current = null;
      islandLongPressed.current = true;
      onOpenEditor();
    }, 450);
  }

  function trackIslandPress(event: PointerEvent<HTMLElement>) {
    const origin = islandPressOrigin.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearIslandPress();
  }

  return (
    <nav
      className="soft-island"
      data-testid="soft-island"
      aria-label="Primary apps"
      title="Press and hold or right-click to change these four apps"
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenEditor();
      }}
      onPointerDown={startIslandPress}
      onPointerMove={trackIslandPress}
      onPointerUp={clearIslandPress}
      onPointerCancel={clearIslandPress}
      onPointerLeave={clearIslandPress}
      onClickCapture={(event) => {
        if (!islandLongPressed.current) return;
        islandLongPressed.current = false;
        if (event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {islandTabs.map((tab) => (
        <a
          aria-current={activeIslandTabHref === tab.href ? "page" : undefined}
          href={withOrgHref(tab.href, orgId)}
          key={tab.href}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
          {tab.href.includes("tab=messages") && unreadMessages >= 1 ? (
            <b className="soft-island-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>
          ) : null}
        </a>
      ))}
      <button
        type="button"
        className="soft-island-more"
        aria-label="Open all apps"
        aria-expanded={navOpen}
        onClick={onOpenNav}
      >
        <Icon name="grid" />
        <span>All</span>
      </button>
    </nav>
  );
}

export function AppShellIslandEditor({
  open,
  islandDraft,
  visibleIslandCatalog,
  islandMessage,
  islandSaving,
  onClose,
  onToggle,
  onReset,
  onSave,
}: {
  open: boolean;
  islandDraft: string[];
  visibleIslandCatalog: IslandTabDefinition[];
  islandMessage: string;
  islandSaving: boolean;
  onClose: () => void;
  onToggle: (href: string) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="soft-island-editor" role="dialog" aria-modal="true" aria-labelledby="island-editor-title">
      <button className="soft-island-editor-scrim" type="button" aria-label="Close island customization" onClick={onClose} />
      <section>
        <header>
          <div>
            <span>BOTTOM ISLAND</span>
            <h2 id="island-editor-title">Four apps</h2>
            <p>Home, Compete, Team, and Build by default. Long-press the island or use the menu to change them.</p>
          </div>
          <button className="soft-icon-btn" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="soft-island-slot-preview" aria-label={`${islandDraft.length} of 4 island apps selected`}>
          {[0, 1, 2, 3].map((slot) => {
            const selectedHref = islandDraft[slot];
            const selected = visibleIslandCatalog.find((entry) => entry.href === selectedHref)
              ?? ISLAND_TAB_CATALOG.find((entry) => entry.href === selectedHref);
            return <span className={selectedHref ? "filled" : ""} key={slot}>{selected ? <><Icon name={selected.icon} />{selected.label}</> : `Slot ${slot + 1}`}</span>;
          })}
        </div>
        <p className="soft-island-order-hint">Tap apps in the order you want them. Tap a selected app to remove it.</p>
        <div className="soft-island-choice-grid">
          {visibleIslandCatalog.map((item) => {
            const selected = islandDraft.includes(item.href);
            const disabled = !selected && islandDraft.length >= 4;
            return (
              <button
                className={selected ? "selected" : ""}
                disabled={disabled}
                key={item.href}
                onClick={() => onToggle(item.href)}
                type="button"
                aria-pressed={selected}
              >
                <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{selected ? `Slot ${islandDraft.indexOf(item.href) + 1}` : "Add"}</small></span>
              </button>
            );
          })}
        </div>
        {islandMessage ? <p className="soft-island-editor-error" role="alert">{islandMessage}</p> : null}
        <footer>
          <button type="button" onClick={onReset}>Reset</button>
          <button className="primary" type="button" disabled={islandDraft.length !== 4 || islandSaving} onClick={onSave}>
            {islandSaving ? "Saving…" : `Save ${islandDraft.length}/4`}
          </button>
        </footer>
      </section>
    </div>
  );
}
