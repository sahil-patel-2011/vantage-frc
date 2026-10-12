"use client";

import { type KeyboardEvent, type RefObject } from "react";
import { Icon } from "./icon";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import type { PinDefinition } from "../lib/nav/pins";
import { AppShellNavGroups } from "./app-shell-nav-groups";
import { ShellSearchResults } from "./shell-search-results";
import type { ShellSearch } from "./use-shell-search";
import { workspacePickerHref } from "../lib/workspace";

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
  searchInputRef,
  orgLabel,
  rolePlanCue,
  orgId,
  search,
  shortcutHint,
  visibleNavGroups,
  pins,
  activeGroupLabel,
  pathname,
  pathSearch,
  navHrefAllowed,
  onEditPins,
}: {
  navOpen: boolean;
  closeNav: () => void;
  panelCloseRef: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  orgLabel: string;
  rolePlanCue: string;
  orgId: string;
  /** The menu's own search (phones and tablets). ⌘K opens the palette instead. */
  search: ShellSearch;
  shortcutHint: string;
  visibleNavGroups: ProductNavGroup[];
  /** "Your apps", already filtered to what this team may open. */
  pins: PinDefinition[];
  activeGroupLabel: string | undefined;
  pathname: string;
  pathSearch: string;
  navHrefAllowed: (href: string) => boolean;
  onEditPins: () => void;
}) {
  const queryActive = search.queryActive;
  return (
    <>
      <button className={`soft-scrim soft-navigation-scrim${navOpen ? " open" : ""}`} type="button" aria-label="Close navigation" aria-hidden={!navOpen} inert={!navOpen} tabIndex={-1} onClick={closeNav} />
      <aside
        id="vantage-navigation-panel"
        className={`soft-drawer ${navOpen ? "open" : ""}`}
        data-searching={queryActive}
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
          {/* The same destination as the top bar's team button and the sidebar's team card: the
              picker, which brings you back to this page for the team you pick. */}
          <a className="soft-org-chip" href={workspacePickerHref(pathname, pathSearch)} onClick={closeNav} aria-label={`Switch team — ${orgLabel}`}>
            <Icon name="users" />
            <div><strong>{orgLabel}</strong><span>{orgId ? rolePlanCue : "Choose your team"}</span></div>
            <Icon name="chevron" />
          </a>
        </div>

        <div className="soft-panel-search">
          <Icon name="search" />
          <input
            id="soft-nav-search"
            ref={searchInputRef}
            type="search"
            role="combobox"
            aria-label="Search pages, tools, and your team's data"
            aria-expanded={search.rows.length > 0}
            aria-controls={queryActive ? "soft-nav-results" : undefined}
            aria-activedescendant={queryActive && search.activeIndex >= 0 ? `soft-nav-row-${search.activeIndex}` : undefined}
            value={search.query}
            placeholder="Search Vantage"
            autoComplete="off"
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={search.onFieldKeyDown}
          />
          {search.query ? (
            <button
              type="button"
              className="soft-panel-search-clear"
              aria-label="Clear search"
              onClick={() => {
                search.setQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <Icon name="x" />
            </button>
          ) : shortcutHint ? (
            <kbd aria-hidden="true">{shortcutHint}</kbd>
          ) : null}
        </div>

        {queryActive ? (
          <div className="soft-nav-results">
            <ShellSearchResults search={search} idPrefix="soft-nav" orgId={orgId} shortcutHint={shortcutHint} />
          </div>
        ) : (
          <nav className="soft-drawer-flat" aria-label="Main menu">
            <AppShellNavGroups key={`${navOpen}-${orgId}-${pathname}-${pathSearch}`}
              groups={visibleNavGroups} pins={pins} activeGroupLabel={activeGroupLabel}
              pathname={pathname} pathSearch={pathSearch} orgId={orgId}
              navHrefAllowed={navHrefAllowed} closeNav={closeNav} onEditPins={onEditPins}
            />
          </nav>
        )}
        {/* The menu is for going places. Who you are (Team admin, Platform admin, Sign out) lives
            in the avatar menu at the top right, on every screen size, so neither repeats the other.
            Your apps are edited from their own heading, so the toolbar keeps Account and Help. */}
        {!queryActive ? <footer className="soft-drawer-foot soft-drawer-toolbar" aria-label="Help and settings">
          <a href={withOrgHref("/account", orgId)} onClick={closeNav}><Icon name="gear" /><span>Account</span></a>
          <a href={withOrgHref("/help", orgId)} onClick={closeNav}><Icon name="book" /><span>Help</span></a>
        </footer> : null}
      </aside>
    </>
  );
}
