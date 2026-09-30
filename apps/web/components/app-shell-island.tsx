"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { defaultIslandLabelList } from "../lib/nav/island-preferences";
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
  // The action for the page you are on is marked, not offered: "Brief" was a filled button on
  // the briefing itself and on every other page, so it read as the current tab everywhere.
  const pathname = usePathname() ?? "";
  const isHere = (href: string) => {
    const path = href.split(/[?#]/)[0] ?? "";
    return path.length > 1 && pathname === path;
  };
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
        {eventFocus.actions.map((action) =>
          isHere(action.href) ? (
            <span className="is-current" aria-current="page" key={action.label}>
              {action.label}
            </span>
          ) : (
            <a className={action.emphasis} href={action.href} key={action.label}>
              {action.label}
            </a>
          ),
        )}
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
  onOpenEditor,
  islandPressTimer,
  islandPressOrigin,
  islandLongPressed,
}: {
  orgId: string;
  islandTabs: IslandTabDefinition[];
  activeIslandTabHref: string | undefined;
  unreadMessages: number;
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
      data-tour="island"
      aria-label="Primary apps"
      title="Press and hold to change these four apps (or Account → Appearance)"
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
          key={tab.href}
          aria-label={tab.href.includes("tab=messages") && unreadMessages >= 1 ? `${tab.label}, ${unreadMessages} unread` : tab.label}
          aria-current={activeIslandTabHref === tab.href ? "page" : undefined}
          href={withOrgHref(tab.href, orgId)}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
          {tab.href.includes("tab=messages") && unreadMessages >= 1 ? (
            <b className="soft-island-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>
          ) : null}
        </a>
      ))}
      {/* No "Apps" gear: it took a fifth of the bar to repeat Account → Appearance. Press and
          hold the bar (or right-click it) to change the four apps. */}
      {/*
        No fifth "All" button.

        It opened the same drawer the hamburger at the top-left already opens,
        so the island spent a fifth of itself on a duplicate — and a duplicate
        that read like a peer of Team, Compete, Scout and Build when it is not
        one of your apps at all. Four apps you chose, and one way to see the
        rest of them.
      */}
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('header button')?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div ref={dialogRef} className="soft-island-editor" role="dialog" aria-modal="true" aria-labelledby="island-editor-title"
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),a[href]')];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <button className="soft-island-editor-scrim" tabIndex={-1} type="button" aria-label="Close island customization" onClick={onClose} />
      <section>
        <header>
          <div>
            <span>BOTTOM BAR</span>
            <h2 id="island-editor-title">Your four apps</h2>
            <p>{defaultIslandLabelList()} by default. Tap apps in the order you want them.</p>
          </div>
          <button className="soft-icon-btn" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="soft-island-slot-preview" role="group" aria-label={`${islandDraft.length} of 4 island apps selected`}>
          {[0, 1, 2, 3].map((slot) => {
            const selectedHref = islandDraft[slot];
            const selected = visibleIslandCatalog.find((entry) => entry.href === selectedHref)
              ?? ISLAND_TAB_CATALOG.find((entry) => entry.href === selectedHref);
            if (selected && !visibleIslandCatalog.some(entry => entry.href === selected.href)) {
              return <button className="filled" key={slot} type="button" disabled={islandSaving}
                aria-label={`Remove ${selected.label}. Unavailable for this team.`} onClick={() => {
                  onToggle(selected.href);
                  // This removal button disappears. Keep keyboard focus in
                  // the editor on a surviving choice (or its close button).
                  (dialogRef.current?.querySelector<HTMLButtonElement>('.soft-island-choice-grid button:not(:disabled)')
                    ?? dialogRef.current?.querySelector<HTMLButtonElement>('header button'))?.focus();
                }}>
                <Icon name={selected.icon} />{selected.label}<small>Unavailable · Remove</small>
              </button>;
            }
            return <span className={selectedHref ? "filled" : ""} key={slot}>{selected ? <><Icon name={selected.icon} />{selected.label}</> : `${slot + 1}`}</span>;
          })}
        </div>
        <p className="soft-island-order-hint">Tap apps in the order you want them. Tap a selected app to remove it.</p>
        <div className="soft-island-choice-grid">
          {visibleIslandCatalog.map((item) => {
            const selected = islandDraft.includes(item.href);
            const disabled = islandSaving || (!selected && islandDraft.length >= 4);
            return (
              <button
                className={selected ? "selected" : ""}
                disabled={disabled}
                key={item.href}
                onClick={() => onToggle(item.href)}
                type="button"
                aria-pressed={selected}
              >
                <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{selected ? `App ${islandDraft.indexOf(item.href) + 1} of 4` : "Add"}</small></span>
              </button>
            );
          })}
        </div>
        {islandMessage ? <p className="soft-island-editor-error" role="alert">{islandMessage}</p> : null}
        <footer>
          <button type="button" disabled={islandSaving} onClick={onReset}>Reset</button>
          <button className="primary" type="button" disabled={islandDraft.length !== 4 || islandSaving} onClick={onSave}>
            {islandSaving ? "Saving…" : "Save"}
          </button>
        </footer>
      </section>
    </div>
  );
}
