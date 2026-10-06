"use client";

import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "./icon";
import {
  type Me,
  type MembershipOption,
  type NavResultRow,
  type SearchHit,
} from "./app-shell-model";
import type { CommandHit } from "../lib/nav/command-search";
import { withOrgHref, type IslandTabDefinition, type ProductNavGroup } from "../lib/nav/product-nav";
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
  searchInputRef,
  me,
  orgLabel,
  rolePlanCue,
  orgId,
  memberships,
  navQuery,
  setNavQuery,
  resultRows,
  commandHits,
  searchHits,
  searchLoading,
  queryActive,
  activeRowIndex,
  setResultCursor,
  goToCommand,
  openFullSearch,
  jumpTopResult,
  shortcutHint,
  visibleNavGroups,
  activeGroupLabel,
  pathname,
  pathSearch,
  navHrefAllowed,
  openIslandEditor,
  signingOut,
  onSignOut,
}: {
  navOpen: boolean;
  closeNav: () => void;
  panelCloseRef: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  me: Me;
  initial: string;
  accountLabel: string | null;
  orgLabel: string;
  rolePlanCue: string;
  orgId: string;
  workspaceOpen: boolean;
  setWorkspaceOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  memberships: MembershipOption[];
  teamsLoaded: boolean;
  orderedMemberships: MembershipOption[];
  switchWorkspaceHref: (nextOrgId: string) => string;
  onWorkspaceSwitch: (nextOrgId: string) => void;
  navQuery: string;
  setNavQuery: (value: string) => void;
  resultRows: NavResultRow[];
  commandHits: CommandHit[];
  searchHits: SearchHit[];
  searchLoading: boolean;
  queryActive: boolean;
  activeRowIndex: number;
  setResultCursor: (value: number | ((current: number) => number)) => void;
  goToCommand: (hit: CommandHit) => void;
  openFullSearch: () => void;
  jumpTopResult: () => void;
  shortcutHint: string;
  visibleNavGroups: ProductNavGroup[];
  islandTabs: IslandTabDefinition[];
  activeGroupLabel: string | undefined;
  pathname: string;
  pathSearch: string;
  navHrefAllowed: (href: string) => boolean;
  openIslandEditor: () => void;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  useEffect(() => {
    if (!navOpen || !queryActive || activeRowIndex < 0) return;
    document.getElementById(`soft-nav-row-${activeRowIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [navOpen, queryActive, activeRowIndex]);
  const activeMembershipRole = orgId
    ? (memberships.find((row) => row.orgId === orgId)?.role ?? null)
    : null;
  return (
    <>
      {navOpen ? (
        <button className="soft-scrim" type="button" aria-label="Close navigation" onClick={closeNav} />
      ) : null}
      <aside
        id="vantage-navigation-panel"
        className={`soft-drawer ${navOpen ? "open" : ""}`}
        data-searching={queryActive}
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
            aria-label="Close"
            ref={panelCloseRef}
            onClick={closeNav}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="soft-profile-block soft-profile-compact">
          <div className="soft-org-chip">
            <Icon name="users" />
            <div><strong>{orgLabel}</strong><span>{orgId ? rolePlanCue : "Choose a team in Settings"}</span></div>
          </div>
        </div>

        <div className="soft-panel-search">
          <Icon name="search" />
          <input
            id="soft-nav-search"
            ref={searchInputRef}
            type="search"
            role="combobox"
            aria-label="Search pages, tools, and your team's data"
            aria-expanded={resultRows.length > 0}
            aria-controls={queryActive ? "soft-nav-results" : undefined}
            aria-activedescendant={activeRowIndex >= 0 ? `soft-nav-row-${activeRowIndex}` : undefined}
            value={navQuery}
            placeholder="Search Vantage"
            autoComplete="off"
            onChange={(event) => setNavQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (resultRows.length) {
                  setResultCursor((current) => (current + 1) % resultRows.length);
                }
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (resultRows.length) {
                  setResultCursor((current) => (current - 1 + resultRows.length) % resultRows.length);
                }
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) {
                  openFullSearch();
                  return;
                }
                jumpTopResult();
              }
            }}
          />
          {navQuery ? (
            <button
              type="button"
              className="soft-panel-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setNavQuery("");
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
          <div id="soft-nav-results" role={resultRows.length ? "listbox" : undefined} aria-label="Search results">
            {commandHits.length > 0 ? (
              <div className="command-group" role="group" aria-label="Go to">
                <p className="command-group-head">Go to</p>
                {commandHits.map((hit, index) => (
                  <a
                    id={`soft-nav-row-${index}`}
                    role="option"
                    aria-selected={index === activeRowIndex}
                    className={index === activeRowIndex ? "is-active" : undefined}
                    href={withOrgHref(hit.href, orgId)}
                    key={hit.id}
                    onMouseEnter={() => setResultCursor(index)}
                    onClick={(event) => {
                      event.preventDefault();
                      goToCommand(hit);
                    }}
                  >
                    <Icon name={hit.kind === "action" ? "bolt" : "grid"} />
                    <span>
                      {hit.label}
                      <small>{hit.context}</small>
                    </span>
                    {index === activeRowIndex ? <small aria-hidden="true">↵</small> : null}
                  </a>
                ))}
              </div>
            ) : null}

            {searchHits.length > 0 ? (
              <section className="command-search-hits" role="group" aria-label="Your data">
                <header>
                  <strong>In your team&apos;s data</strong>
                  {searchLoading ? <small>Searching…</small> : null}
                </header>
                <nav role="presentation">
                  {searchHits.map((hit, offset) => {
                    const index = commandHits.length + offset;
                    return (
                      <a
                        id={`soft-nav-row-${index}`}
                        role="option"
                        aria-selected={index === activeRowIndex}
                        className={index === activeRowIndex ? "is-active" : undefined}
                        href={hit.href}
                        key={`${hit.href}-${hit.title}`}
                        onMouseEnter={() => setResultCursor(index)}
                        onClick={closeNav}
                      >
                        <Icon name="search" />
                        <span>
                          {hit.title}
                          {hit.subtitle ? <small>{hit.subtitle}</small> : null}
                        </span>
                        {hit.sourceLabel ? <small>{hit.sourceLabel}</small> : null}
                      </a>
                    );
                  })}
                </nav>
              </section>
            ) : null}
          </div>
            {searchLoading ? <p role="status">Searching your team’s data…</p> : null}
            <button type="button" className="command-open-full" onClick={openFullSearch}>
              Open full search for “{navQuery.trim()}”
            </button>
            {resultRows.length === 0 && !searchLoading ? (
              <p className="command-empty">
                Nothing matches “{navQuery.trim()}”. Press Ctrl/⌘+Enter to search your data.
              </p>
            ) : null}
          </div>
        ) : (
          <nav className="soft-drawer-flat" aria-label="Main menu">
            <AppShellNavGroups key={`${navOpen}-${activeGroupLabel}`}
              groups={visibleNavGroups} activeGroupLabel={activeGroupLabel}
              pathname={pathname} pathSearch={pathSearch} orgId={orgId}
              navHrefAllowed={navHrefAllowed} closeNav={closeNav}
            />
          </nav>
        )}
        {/* Settings, split the way people ask for them: "my stuff" and "the
            team's stuff". Both used to be somewhere inside the hub lists, which
            meant hunting through Team for a sign-in preference. The team link
            only appears for an owner or admin, because for everyone else it is a
            door that opens onto an error. */}
        {!queryActive ? <><div className="soft-drawer-settings">
          {me.platformAdmin ? (
            <a href="/admin" onClick={closeNav}><Icon name="grid" /><span><strong>Platform admin</strong></span></a>
          ) : null}
          <a href={withOrgHref("/account", orgId)} onClick={closeNav}>
            <Icon name="gear" />
            <span>
              <strong>Personal settings</strong>

            </span>
          </a>
          {orgId && ["owner", "admin"].includes(activeMembershipRole ?? "") ? (
            <a href={withOrgHref("/team/admin", orgId)} onClick={closeNav}>
              <Icon name="users" />
              <span>
                <strong>Team admin</strong>

              </span>
            </a>
          ) : null}
        </div>
        <footer className="soft-drawer-foot">
          <button type="button" onClick={openIslandEditor}>
            Edit shortcuts
          </button>
          <button type="button" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </footer></> : null}
      </aside>
    </>
  );
}
