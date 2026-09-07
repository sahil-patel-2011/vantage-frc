"use client";

import { useState } from "react";
import { Icon } from "./icon";
import {
  dedupeSidebarQuickActions,
  type ShellHub,
  type ShellQuickAction,
  type ShellRecent,
} from "../../lib/nav/shell-model";
import { withOrgHref } from "../../lib/nav/product-nav";

export type ShellMembership = {
  orgId: string;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

type ShellNavProps = {
  /** `drawer` slides over the page on phones; `sidebar` is the persistent laptop rail. */
  variant: "drawer" | "sidebar";
  /** Sidebar only — icon rail with labels hidden. */
  collapsed?: boolean;
  hubs: ShellHub[];
  quickActions: ShellQuickAction[];
  recents: ShellRecent[];
  orgId: string;
  orgLabel: string;
  roleCue: string;
  memberships: ShellMembership[];
  membershipLabel: (row: ShellMembership) => string;
  switchWorkspaceHref: (orgId: string) => string;
  onWorkspaceSwitch: (orgId: string) => void;
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
  accountLabel: string;
  initial: string;
  image?: string | null;
  platformAdmin: boolean;
  ownerAdmin: boolean;
  shortcutHint: string;
  signingOut: boolean;
  onNavigate: () => void;
  onClose?: () => void;
  onOpenSearch: () => void;
  onOpenIslandEditor: () => void;
  onSignOut: () => void;
  onToggleCollapsed?: () => void;
};

/**
 * One navigation body for both chrome variants. Two levels only: the hub row
 * links to the hub, and its workbench chips link to each tab. Everything
 * deeper lives inside the hub's tool strip and in ⌘K.
 */
export function ShellNav(props: ShellNavProps) {
  const {
    variant,
    collapsed = false,
    hubs,
    quickActions,
    recents,
    orgId,
    orgLabel,
    roleCue,
    memberships,
    membershipLabel,
    switchWorkspaceHref,
    onWorkspaceSwitch,
    workspaceOpen,
    onToggleWorkspace,
    accountLabel,
    initial,
    image,
    platformAdmin,
    ownerAdmin,
    shortcutHint,
    signingOut,
    onNavigate,
    onClose,
    onOpenSearch,
    onOpenIslandEditor,
    onSignOut,
    onToggleCollapsed,
  } = props;
  const rail = variant === "sidebar" && collapsed;
  const pickerId = `shell-workspace-picker-${variant}`;
  // Only the sidebar shows every hub's chips at once, so only it can duplicate
  // a quick action. The drawer peeks one hub at a time and keeps the full set.
  const actions =
    variant === "sidebar" ? dedupeSidebarQuickActions(quickActions, hubs) : quickActions;
  // Drawer only: a collapsed hub can be peeked open without leaving the page.
  const [peekHubId, setPeekHubId] = useState<string | null>(null);

  return (
    <div className={`shell-nav shell-nav--${variant}${rail ? " is-rail" : ""}`}>
      <header className="shell-nav-head">
        {rail ? (
          <a className="shell-brand shell-brand--mark" href={withOrgHref("/dashboard", orgId)} onClick={onNavigate} title="Home">
            <span className="shell-brand-mark">v</span>
          </a>
        ) : (
          <div className="shell-workspace">
            <button
              type="button"
              className="shell-workspace-btn"
              aria-expanded={workspaceOpen}
              aria-controls={pickerId}
              onClick={onToggleWorkspace}
              title={orgLabel}
            >
              <span className="shell-brand-mark" aria-hidden="true">
                v
              </span>
              <span className="shell-workspace-copy">
                <strong>{orgLabel}</strong>
                <small className={orgId ? "is-role" : undefined}>{orgId ? roleCue : "Pick a team"}</small>
              </span>
              <span className={`shell-caret${workspaceOpen ? " open" : ""}`} aria-hidden="true">
                <Icon name="chevron" size={14} />
              </span>
            </button>
            {workspaceOpen ? (
              <div id={pickerId} className="shell-workspace-picker" role="listbox" aria-label="Team workspaces">
                {memberships.length === 0 ? (
                  <p className="shell-workspace-empty">No team yet — open an invite from email.</p>
                ) : (
                  memberships.map((row) => (
                    <a
                      key={row.orgId}
                      role="option"
                      aria-selected={row.orgId === orgId}
                      href={switchWorkspaceHref(row.orgId)}
                      onClick={() => {
                        onWorkspaceSwitch(row.orgId);
                        onNavigate();
                      }}
                    >
                      <strong>{membershipLabel(row)}</strong>
                      <span>
                        {row.role ?? "member"}
                        {row.orgId === orgId ? " · active" : ""}
                      </span>
                    </a>
                  ))
                )}
                <div className="shell-workspace-links">
                  <a href={withOrgHref("/workspace", orgId)} onClick={onNavigate}>
                    All workspaces
                  </a>
                  <a href="/invite" onClick={onNavigate}>
                    Open an invite
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {variant === "drawer" && onClose ? (
          <button className="soft-icon-btn shell-close" type="button" aria-label="Close navigation" onClick={onClose}>
            <Icon name="x" />
          </button>
        ) : null}
        {variant === "sidebar" && onToggleCollapsed ? (
          <button
            className="soft-icon-btn shell-collapse"
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            onClick={onToggleCollapsed}
          >
            <Icon name="panel" />
          </button>
        ) : null}
      </header>

      <button type="button" className="shell-search" onClick={onOpenSearch} aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" />
        {!rail ? (
          <>
            <span>Search or jump to…</span>
            <kbd aria-hidden="true">{shortcutHint}</kbd>
          </>
        ) : null}
      </button>

      {actions.length > 0 ? (
        <nav className="shell-quick" aria-label="Quick actions">
          {actions.map((action) => (
            <a
              key={action.id}
              className={`shell-quick-item${action.tone === "primary" ? " is-primary" : ""}`}
              href={withOrgHref(action.href, orgId)}
              onClick={onNavigate}
              title={rail ? action.label : undefined}
            >
              <i>
                <Icon name={action.icon} size={18} />
              </i>
              {!rail ? <span>{action.label}</span> : null}
              {action.badge && action.badge > 0 ? (
                <b className="shell-badge" aria-label={`${action.badge} unread`}>
                  {action.badge > 99 ? "99+" : action.badge}
                </b>
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}

      <nav className="shell-hubs" aria-label="Hubs">
        {hubs.map((hub) => (
          <section
            key={hub.id}
            className={`shell-hub${hub.active ? " is-active" : ""}${peekHubId === hub.id ? " is-open" : ""}`}
            aria-label={hub.label}
          >
            <div className="shell-hub-row">
              <a
                className="shell-hub-link"
                href={withOrgHref(hub.href, orgId)}
                aria-current={hub.active && !hub.tabs.some((tab) => tab.current) ? "page" : undefined}
                onClick={onNavigate}
                title={rail ? hub.label : undefined}
              >
                <i>
                  <Icon name={hub.icon} size={18} />
                </i>
                {!rail ? <span>{hub.label}</span> : null}
              </a>
              {/* Both chromes peek the same way. The rail has no room for it. */}
              {!rail && !hub.active && hub.tabs.length > 0 ? (
                <button
                  type="button"
                  className="shell-hub-peek"
                  aria-expanded={peekHubId === hub.id}
                  aria-label={`${peekHubId === hub.id ? "Hide" : "Show"} ${hub.label} sections`}
                  onClick={() => setPeekHubId((current) => (current === hub.id ? null : hub.id))}
                >
                  <Icon name="chevron" size={16} />
                </button>
              ) : null}
            </div>
            {!rail && hub.tabs.length > 0 ? (
              <div className="shell-hub-tabs">
                {hub.tabs.map((tab) => (
                  <a
                    key={tab.id}
                    href={withOrgHref(tab.href, orgId)}
                    aria-current={tab.current ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    {tab.label}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ))}
        {platformAdmin ? (
          <a className="shell-hub-link shell-hub-link--platform" href="/admin" onClick={onNavigate} title={rail ? "Team manager" : undefined}>
            <i>
              <Icon name="grid" size={18} />
            </i>
            {!rail ? <span>Team manager</span> : null}
          </a>
        ) : null}
      </nav>

      {!rail && recents.length > 0 ? (
        <nav className="shell-recents" aria-label="Recent">
          <p className="shell-section-head">Recent</p>
          {recents.map((row) => (
            <a key={row.href} href={withOrgHref(row.href, orgId)} onClick={onNavigate}>
              <Icon name="clock" size={14} />
              <span>
                {row.label}
                <small>{row.context}</small>
              </span>
            </a>
          ))}
        </nav>
      ) : null}

      <footer className="soft-drawer-foot shell-foot">
        <a className="shell-account" href="/account" onClick={onNavigate} title={rail ? accountLabel : undefined}>
          <span className="soft-avatar shell-avatar">
            {image ? (
               
              <img src={image} alt="" />
            ) : (
              initial
            )}
          </span>
          {!rail ? (
            <span className="shell-account-copy">
              <strong>{accountLabel}</strong>
              <small>Profile &amp; settings</small>
            </span>
          ) : null}
        </a>
        {!rail ? (
          <div className="shell-foot-links">
            <a href="/account?tab=appearance" onClick={onNavigate}>
              Appearance
            </a>
            {ownerAdmin ? (
              <a href="/team/admin" onClick={onNavigate}>
                Team admin
              </a>
            ) : null}
            <a href="/docs" onClick={onNavigate}>
              Manual
            </a>
            {/* Named for what it edits, not where it sits — the bar itself is
                hidden on laptops, but you can still pick its four apps here. */}
            <button type="button" onClick={onOpenIslandEditor}>
              Customize apps
            </button>
            <button type="button" className="shell-signout" disabled={signingOut} onClick={onSignOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="soft-icon-btn shell-signout-rail"
            aria-label="Sign out"
            title="Sign out"
            disabled={signingOut}
            onClick={onSignOut}
          >
            <Icon name="logout" />
          </button>
        )}
      </footer>
    </div>
  );
}
