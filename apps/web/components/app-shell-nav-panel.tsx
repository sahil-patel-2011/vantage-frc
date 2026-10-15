"use client";

import { type KeyboardEvent, type RefObject } from "react";
import { Icon } from "./icon";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import type { PinDefinition } from "../lib/nav/pins";
import { SETTINGS_HREF } from "../lib/nav/settings-nav";
import { AppShellNavGroups } from "./app-shell-nav-groups";

function keepTabInsidePanel(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  const focusable = [
    ...root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

export function AppShellNavPanel({
  navOpen,
  closeNav,
  panelCloseRef,
  orgLabel,
  rolePlanCue,
  orgId,
  onOpenSearch,
  visibleNavGroups,
  pins,
  activeGroupLabel,
  pathname,
  pathSearch,
  navHrefAllowed,
  onEditPins,
  platformAdmin = false,
}: {
  navOpen: boolean;
  closeNav: () => void;
  panelCloseRef: RefObject<HTMLButtonElement | null>;
  orgLabel: string;
  rolePlanCue: string;
  orgId: string;
  /** Opens the search palette (the app's one search) in place of the menu. */
  onOpenSearch: () => void;
  visibleNavGroups: ProductNavGroup[];
  /** "Your apps", already filtered to what this team may open. */
  pins: PinDefinition[];
  activeGroupLabel: string | undefined;
  pathname: string;
  pathSearch: string;
  navHrefAllowed: (href: string) => boolean;
  onEditPins: () => void;
  /** Runs Vantage itself: the menu gets an Admin button beside Settings and Help. */
  platformAdmin?: boolean;
}) {
  return (
    <>
      <button className={`soft-scrim soft-navigation-scrim${navOpen ? " open" : ""}`} type="button" aria-label="Close navigation" aria-hidden={!navOpen} inert={!navOpen} tabIndex={-1} onClick={closeNav} />
      <aside
        id="vantage-navigation-panel"
        className={`soft-drawer ${navOpen ? "open" : ""}`}
        role="dialog"
        aria-modal={navOpen || undefined}
        aria-hidden={!navOpen}
        inert={!navOpen}
        aria-label="Product navigation"
        onKeyDown={navOpen ? keepTabInsidePanel : undefined}
      >
        <div className="soft-drawer-head">
          <div className="soft-drawer-brand">
            {/* The real mark, not a lowercase "v" in a yellow circle. */}
            <img className="soft-drawer-logo" src="/vantage-mark.svg" alt="" width={28} height={28} />
            <div>
              <strong>Vantage</strong>
            </div>
          </div>
          <button
            className="soft-icon-btn"
            type="button"
            aria-label="Close menu"
            ref={panelCloseRef}
            onClick={closeNav}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="soft-profile-block soft-profile-compact">
          <div className="soft-org-chip" aria-label={`Current team — ${orgLabel}`}>
            <Icon name="users" />
            <div><strong>{orgLabel}</strong><span>{orgId ? rolePlanCue : "Choose your team"}</span></div>
          </div>
        </div>

        {/* The app's one search: the palette, the same as ⌘K and Search in the top bar. The menu
            used to keep a second search field with its own results. */}
        <button type="button" className="soft-panel-search soft-panel-search-button" onClick={onOpenSearch}>
          <Icon name="search" />
          <span>Search Vantage</span>
        </button>

        <nav className="soft-drawer-flat" aria-label="Main menu">
          <AppShellNavGroups key={`${navOpen}-${orgId}-${pathname}-${pathSearch}`}
            groups={visibleNavGroups} pins={pins} activeGroupLabel={activeGroupLabel}
            pathname={pathname} pathSearch={pathSearch} orgId={orgId}
            navHrefAllowed={navHrefAllowed} closeNav={closeNav} onEditPins={onEditPins}
          />
        </nav>
        {/* App utilities have one location; the avatar holds only personal account actions. */}
        <footer className="soft-drawer-foot soft-drawer-toolbar" aria-label="Help and settings">
          <a href={withOrgHref(SETTINGS_HREF, orgId)} onClick={closeNav}><Icon name="gear" /><span>Settings</span></a>
          <a href={withOrgHref("/help", orgId)} data-tour="feedback" onClick={closeNav}><Icon name="book" /><span>Help</span></a>
          {platformAdmin ? <a href="/admin" onClick={closeNav}><Icon name="shield" /><span>Admin</span></a> : null}
        </footer>
      </aside>
    </>
  );
}
