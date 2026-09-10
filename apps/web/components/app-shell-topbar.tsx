"use client";

import { Icon } from "./icon";
import { ShellOutboxStatus } from "./shell-outbox-status";
import { AppShellAccountMenu } from "./app-shell-account-menu";
import { withOrgHref } from "../lib/nav/product-nav";
import type { Me, MembershipOption } from "./app-shell-model";

export function AppShellTopbar({
  showBack,
  onBack,
  isHubRoot,
  title,
  orgLabel,
  crumbHint,
  orgId,
  navOpen,
  onOpenNav,
  shortcutHint,
  unreadCount,
  accountMenuOpen,
  onToggleAccount,
  onCloseAccount,
  me,
  initial,
  accountLabel,
  rolePlanCue,
  memberships,
  orderedMemberships,
  recentOrgIds,
  signingOut,
  switchWorkspaceHref,
  onWorkspaceSwitch,
  onSignOut,
}: {
  showBack: boolean;
  onBack: () => void;
  isHubRoot: boolean;
  title: string | null;
  orgLabel: string;
  crumbHint: string | null;
  orgId: string;
  navOpen: boolean;
  onOpenNav: () => void;
  shortcutHint: string;
  unreadCount: number;
  accountMenuOpen: boolean;
  onToggleAccount: () => void;
  onCloseAccount: () => void;
  me: Me;
  initial: string;
  accountLabel: string | null;
  rolePlanCue: string;
  memberships: MembershipOption[];
  orderedMemberships: MembershipOption[];
  recentOrgIds: string[];
  signingOut: boolean;
  switchWorkspaceHref: (nextOrgId: string) => string;
  onWorkspaceSwitch: (nextOrgId: string) => void;
  onSignOut: () => void;
}) {
  return (
    <header className={`soft-topbar${accountMenuOpen ? " account-menu-open" : ""}`}>
      <div className={`soft-topbar-lead${showBack ? " has-back" : ""}`}>
        <div className="soft-page-head">
          {showBack ? (
            <button
              className="soft-icon-btn"
              type="button"
              aria-label="Go back"
              onClick={onBack}
            >
              <Icon name="back" />
            </button>
          ) : null}
          <div className="soft-page-head-copy">
            {isHubRoot ? (
              <p className="soft-topbar-title soft-topbar-org">{orgLabel}</p>
            ) : (
              <>
                <p className="soft-topbar-title">{title ?? "Vantage"}</p>
                <small className="soft-org-crumb">{showBack ? crumbHint : orgLabel}</small>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="soft-topbar-actions">
        <ShellOutboxStatus orgId={orgId || null} />
        <a
          className="soft-icon-btn soft-ask-ai"
          href={withOrgHref("/ai?tab=chat", orgId || null)}
          aria-label="Ask AI"
          title="Ask AI — strategy, match predictions, design help"
        >
          <Icon name="bolt" />
          <span className="soft-ask-ai-label">Ask AI</span>
        </a>
        {navOpen ? null : (
          <button
            className="soft-icon-btn soft-search-btn"
            type="button"
            aria-label="Search Vantage"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={onOpenNav}
          >
            <Icon name="search" />
            <span className="soft-search-label">Search</span>
            <kbd className="soft-search-kbd" aria-hidden="true">
              {shortcutHint}
            </kbd>
          </button>
        )}
        <a
          className="soft-icon-btn soft-notif"
          href="/notifications"
          aria-label={unreadCount >= 1 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Icon name="bell" />
          {unreadCount >= 1 ? <b data-count={unreadCount}>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
        </a>
        <div className="soft-account-menu">
          <button
            className="soft-avatar soft-avatar-btn"
            type="button"
            aria-label="Account menu"
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            onClick={onToggleAccount}
          >
            {me.image ? <img src={me.image} alt="" /> : initial}
          </button>
          <AppShellAccountMenu
            open={accountMenuOpen}
            me={me}
            accountLabel={accountLabel}
            orgLabel={orgLabel}
            rolePlanCue={rolePlanCue}
            orgId={orgId}
            memberships={memberships}
            orderedMemberships={orderedMemberships}
            recentOrgIds={recentOrgIds}
            signingOut={signingOut}
            onClose={onCloseAccount}
            switchWorkspaceHref={switchWorkspaceHref}
            onWorkspaceSwitch={onWorkspaceSwitch}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    </header>
  );
}
