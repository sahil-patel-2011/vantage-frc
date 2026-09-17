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
        {/* Navigation opens from the left, where a hamburger lives on every
            other app. The right side is for things you act on. */}
        {navOpen ? null : (
          <button
            className="soft-icon-btn soft-menu-btn"
            type="button"
            aria-label="Menu and search"
            aria-expanded={navOpen}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={onOpenNav}
          >
            <span className="soft-burger" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        )}
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
                {/* The line under the title is the team, or the crumb when
                    there is a back button. Either can repeat the title —
                    "6925" over "6925" — which reads as a rendering bug rather
                    than a hierarchy, so the second line is dropped when it
                    would only say the same thing again. */}
                {(() => {
                  const sub = showBack ? crumbHint : orgLabel;
                  if (!sub) return null;
                  const same = sub.trim().toLowerCase() === (title ?? "").trim().toLowerCase();
                  return same ? null : <small className="soft-org-crumb">{sub}</small>;
                })()}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="soft-topbar-actions">
        {/* The wordmark doubles as the way home — the convention everywhere
            else on the web, so nobody has to learn it. */}
        <a
          className="soft-brand-link"
          href={withOrgHref("/dashboard", orgId || null)}
          aria-label="VantageFRC — go to Home"
        >
          VantageFRC
        </a>
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
