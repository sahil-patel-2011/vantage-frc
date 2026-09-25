"use client";

import type { KeyboardEvent, RefObject } from "react";
import { Icon, type IconName } from "./icon";
import {
  formatMembershipLabel,
  islandTabIsActive,
  type Me,
  type MembershipOption,
  type NavResultRow,
  type SearchHit,
} from "./app-shell-model";
import type { CommandHit } from "../lib/nav/command-search";
import { panelSubLinks, withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { hubHref } from "../lib/nav/hubs";

/** The drawer's first rows for a student or parent: the places a match day uses. */
const MEMBER_QUICK: Array<{ label: string; path: string; icon: IconName; href: (orgId: string | null) => string }> = [
  { label: "Home", path: "/dashboard", icon: "home", href: (orgId) => withOrgHref("/dashboard", orgId) },
  { label: "My Day", path: "/my-day", icon: "calendar", href: (orgId) => hubHref("/competition", "my-day", orgId) },
  { label: "Scout", path: "/scouting", icon: "scout", href: (orgId) => hubHref("/competition", "scouting", orgId) },
  { label: "Strategy", path: "/strategy", icon: "target", href: (orgId) => hubHref("/competition", "strategy", orgId) },
  { label: "Chat", path: "/messages", icon: "chat", href: (orgId) => hubHref("/team", "messages", orgId) },
  { label: "Announcements", path: "/announcements", icon: "bell", href: (orgId) => withOrgHref("/announcements", orgId) },
];

function keepTabInsidePanel(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  const focusable = [
    ...root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
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
  initial,
  accountLabel,
  orgLabel,
  rolePlanCue,
  orgId,
  workspaceOpen,
  setWorkspaceOpen,
  memberships,
  teamsLoaded,
  orderedMemberships,
  switchWorkspaceHref,
  onWorkspaceSwitch,
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
  activeGroupLabel: string | undefined;
  pathname: string;
  pathSearch: string;
  navHrefAllowed: (href: string) => boolean;
  openIslandEditor: () => void;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const activeMembershipRole = orgId
    ? (memberships.find((row) => row.orgId === orgId)?.role ?? null)
    : null;
  const memberView = activeMembershipRole === "scout" || activeMembershipRole === "viewer";
  return (
    <>
      {navOpen ? (
        <button className="soft-scrim" type="button" aria-label="Close navigation" onClick={closeNav} />
      ) : null}
      <aside
        className={`soft-drawer ${navOpen ? "open" : ""}`}
        aria-label="Product navigation"
        onKeyDown={navOpen ? keepTabInsidePanel : undefined}
      >
        <div className="soft-drawer-head">
          <div className="soft-drawer-brand">
            <span className="mark">v</span>
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
          <a className="soft-profile-link" href="/account" onClick={closeNav}>
            <span className="soft-avatar">
              {me.image ? <img src={me.image} alt="" /> : initial}
            </span>
            <div>
              <strong>{accountLabel ?? "Account"}</strong>
              <span>{me.email ?? "Your account"}</span>
            </div>
          </a>
          <div className={`soft-workspace-manager${workspaceOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="soft-org-chip soft-org-chip-btn"
              title={orgLabel}
              aria-expanded={workspaceOpen}
              aria-controls="soft-workspace-picker"
              onClick={() => setWorkspaceOpen((value) => !value)}
            >
              <Icon name="users" />
              <div>
                <strong>{orgLabel}</strong>
                <span>{orgId ? rolePlanCue : "Choose your team"}</span>
              </div>
              <span className={`soft-nav-caret${workspaceOpen ? " open" : ""}`} aria-hidden="true">
                <Icon name="chevron" />
              </span>
            </button>
            {workspaceOpen ? (
              <div id="soft-workspace-picker" className="soft-workspace-picker" role="listbox" aria-label="Your teams">
                {!teamsLoaded ? (
                  <p className="soft-workspace-empty">Checking your team.</p>
                ) : memberships.length === 0 ? (
                  <p className="soft-workspace-empty">
                    No team yet. Open an invite from your email, or{" "}
                    <a href="/#waitlist" onClick={closeNav}>
                      join the waitlist
                    </a>
                    .
                  </p>
                ) : (
                  orderedMemberships.map((row) => (
                    <a
                      key={row.orgId}
                      role="option"
                      aria-selected={row.orgId === orgId}
                      href={switchWorkspaceHref(row.orgId)}
                      onClick={() => {
                        onWorkspaceSwitch(row.orgId);
                        closeNav();
                      }}
                    >
                      <strong>{formatMembershipLabel(row)}</strong>
                      <span>
                        {(row.role ?? "member").charAt(0).toUpperCase() + (row.role ?? "member").slice(1)}
                        {row.orgId === orgId ? " · active" : ""}
                      </span>
                    </a>
                  ))
                )}
                <div className="soft-workspace-links">
                  <a href={withOrgHref("/workspace", orgId)} onClick={closeNav}>
                    Manage teams
                  </a>
                  <a href="/invite" onClick={closeNav}>
                    Have an invite?
                  </a>
                </div>
              </div>
            ) : null}
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
          <div id="soft-nav-results" className="soft-nav-results" role="listbox" aria-label="Search results">
            {commandHits.length > 0 ? (
              <nav className="command-group" aria-label="Go to">
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
              </nav>
            ) : null}

            {searchHits.length > 0 || searchLoading ? (
              <section className="command-search-hits" aria-label="Your data">
                <header>
                  <strong>In your team&apos;s data</strong>
                  {searchLoading ? <small>Searching…</small> : null}
                </header>
                <nav>
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
                <button type="button" className="command-open-full" onClick={openFullSearch}>
                  Open full search for “{navQuery.trim()}”
                </button>
              </section>
            ) : null}

            {resultRows.length === 0 && !searchLoading ? (
              <p className="command-empty">
                Nothing matches “{navQuery.trim()}”. Press Ctrl/⌘+Enter to search your data.
              </p>
            ) : null}
          </div>
        ) : (
          <nav className="soft-drawer-flat" aria-label="Hubs">
            {/* Says what this list is and what it is not: the few places you go
                often, never every screen. Everything else is behind search. */}
            {/* First for a platform admin: it is the page they came for, and it sat below Build. */}
            {me.platformAdmin ? (
              <a className="soft-drawer-hub soft-drawer-platform" href="/admin" onClick={closeNav}>
                <i>
                  <Icon name="grid" />
                </i>
                <span>Platform admin</span>
              </a>
            ) : null}
            {/* A student or parent gets the few places their day uses first, and the rest folded:
                a scout's menu listed 23 destinations and not My Day. */}
            {memberView ? (
              <div className="soft-drawer-quick" aria-label="Your match day">
                {MEMBER_QUICK.filter((entry) => navHrefAllowed(entry.path)).map((entry) => (
                  <a
                    key={entry.label}
                    className="soft-drawer-hub"
                    href={entry.href(orgId)}
                    aria-current={islandTabIsActive(pathname, pathSearch, entry.href(null)) ? "page" : undefined}
                    onClick={closeNav}
                  >
                    <i>
                      <Icon name={entry.icon} />
                    </i>
                    <span>{entry.label}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {memberView ? (
              <details className="soft-drawer-more">
                <summary>Everything else</summary>
            {visibleNavGroups.map((group) => {
              const item = group.items[0];
              if (!item || item.state === "planned") return null;
              const isActive = activeGroupLabel === group.label;
              const sub = panelSubLinks(group).filter((entry) => navHrefAllowed(entry.href));
              const toneStyle = { ["--tone" as string]: group.tone };
              return (
                <div key={group.label} className="soft-nav-group" style={toneStyle}>
                  <a
                    className={`soft-drawer-hub${isActive ? " is-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    href={withOrgHref(item.href, orgId)}
                    onClick={closeNav}
                  >
                    <i>
                      <Icon name={group.icon} />
                    </i>
                    <span>{item.label}</span>
                  </a>
                  {sub.length > 0 ? (
                    <div className="soft-nav-items">
                      {sub.map((entry) => (
                        <a
                          key={entry.href}
                          href={withOrgHref(entry.href, orgId)}
                          aria-current={
                            islandTabIsActive(pathname, pathSearch, entry.href) ? "page" : undefined
                          }
                          onClick={closeNav}
                        >
                          <span>{entry.label}</span>
                          {/* Every row that takes you somewhere says so. These
                              were bare words in a list, indistinguishable from
                              the group headings above them. */}
                          <Icon name="chevron" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
              </details>
            ) : (
              <>
            {visibleNavGroups.map((group) => {
              const item = group.items[0];
              if (!item || item.state === "planned") return null;
              const isActive = activeGroupLabel === group.label;
              const sub = panelSubLinks(group).filter((entry) => navHrefAllowed(entry.href));
              const toneStyle = { ["--tone" as string]: group.tone };
              return (
                <div key={group.label} className="soft-nav-group" style={toneStyle}>
                  <a
                    className={`soft-drawer-hub${isActive ? " is-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    href={withOrgHref(item.href, orgId)}
                    onClick={closeNav}
                  >
                    <i>
                      <Icon name={group.icon} />
                    </i>
                    <span>{item.label}</span>
                  </a>
                  {sub.length > 0 ? (
                    <div className="soft-nav-items">
                      {sub.map((entry) => (
                        <a
                          key={entry.href}
                          href={withOrgHref(entry.href, orgId)}
                          aria-current={
                            islandTabIsActive(pathname, pathSearch, entry.href) ? "page" : undefined
                          }
                          onClick={closeNav}
                        >
                          <span>{entry.label}</span>
                          {/* Every row that takes you somewhere says so. These
                              were bare words in a list, indistinguishable from
                              the group headings above them. */}
                          <Icon name="chevron" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
              </>
            )}
          </nav>
        )}
        {/* Settings, split the way people ask for them: "my stuff" and "the
            team's stuff". Both used to be somewhere inside the hub lists, which
            meant hunting through Team for a sign-in preference. The team link
            only appears for an owner or admin, because for everyone else it is a
            door that opens onto an error. */}
        <div className="soft-drawer-settings">
          <a href="/account" onClick={closeNav}>
            <Icon name="gear" />
            <span>
              <strong>Personal settings</strong>
              <small>Your profile, sign-in and notifications</small>
            </span>
          </a>
          {orgId && ["owner", "admin"].includes(activeMembershipRole ?? "") ? (
            <a href={withOrgHref("/team/admin", orgId)} onClick={closeNav}>
              <Icon name="users" />
              <span>
                <strong>Team admin</strong>
                <small>Members, role profiles and team preferences</small>
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
        </footer>
      </aside>
    </>
  );
}
