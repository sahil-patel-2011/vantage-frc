"use client";

import { Icon } from "./icon";
import { ShellOutboxStatus } from "./shell-outbox-status";
import { AppShellAccountMenu } from "./app-shell-account-menu";
import { withOrgHref } from "../lib/nav/product-nav";
import { crossProductHref } from "../lib/products/products";
import type { Me, MembershipOption } from "./app-shell-model";

/**
 * The team you are in, rendered as the control that changes it.
 *
 * This was plain text. Switching teams lived behind the avatar menu and only
 * appeared there when you already belonged to more than one team — so the
 * label naming your team was inert, and from the one place you would think to
 * look, there was no way to switch, leave, or join another. Same words, same
 * position; now you can press it.
 */
function TeamChip({
  label,
  onOpen,
  className,
}: {
  label: string;
  onOpen: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={`${className} soft-topbar-team`}
      onClick={onOpen}
      aria-label={`${label} — switch team`}
      title="Switch or join a team"
    >
      <span>{label}</span>
      <Icon name="chevron" />
    </button>
  );
}

export function AppShellTopbar({
  showBack,
  onBack,
  isHubRoot,
  title,
  orgLabel,
  crumbHint,
  orgId,
  navOpen,
  menuOpen,
  onOpenNav,
  onOpenTeams,

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
  /** Wide screens: whether the left menu is showing (the button turns into an X). */
  menuOpen: boolean;
  onOpenNav: () => void;
  /** Opens the drawer with the team picker already expanded. */
  onOpenTeams: () => void;

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
            className={`soft-icon-btn soft-menu-btn${menuOpen ? " is-open" : ""}`}
            data-tour="menu"
            type="button"
            aria-label="Menu and search"
            aria-expanded={menuOpen || navOpen}
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
              <TeamChip
                label={orgLabel}
                onOpen={onOpenTeams}
                className="soft-topbar-title soft-topbar-org"
              />
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
                  const heading = (title ?? "").trim().toLowerCase();
                  const crumb = sub.trim().toLowerCase();
                  // A crumb reading "Settings / Account" under a title reading
                  // "Account" ends in the word it sits beneath. Comparing the
                  // whole string missed that, so the page said its own name
                  // twice, one line apart.
                  const tail = crumb.split("/").pop()?.trim() ?? crumb;
                  if (crumb === heading || tail === heading) return null;
                  // The crumb is a location; the team is a thing you can
                  // change. Only the latter becomes a control.
                  return showBack ? (
                    <small className="soft-org-crumb">{sub}</small>
                  ) : (
                    <TeamChip label={sub} onOpen={onOpenTeams} className="soft-org-crumb" />
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="soft-topbar-actions">
        <ShellOutboxStatus orgId={orgId || null} />
        {/* The Scouting product, one tap away and already signed in. */}
        <a
          className="soft-topbar-product"
          href={crossProductHref("scouting", "/scout", orgId || null)}
          title="Open Scouting — fast match entry, team lookup, predictions and the pick list"
        >
          Scouting
        </a>
        <a
          className="soft-icon-btn soft-ask-ai"
          data-tour="ask-ai"
          href={withOrgHref("/ai?tab=chat", orgId || null)}
          aria-label="Ask AI"
          title="Ask AI — strategy, match predictions, design help"
        >
          <Icon name="bolt" />
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
