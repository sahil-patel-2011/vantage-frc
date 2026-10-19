"use client";

import { Icon } from "./icon";
import { ShellOutboxStatus } from "./shell-outbox-status";
import { AppShellAccountMenu } from "./app-shell-account-menu";
import { withOrgHref } from "../lib/nav/product-nav";
import { VIEW_ONLY_CHIP_TITLE, isViewOnlyIn } from "../lib/nav/view-only";
import type { Me, MembershipOption } from "./app-shell-model";
import "./view-only.css";

/** Shown when no name, email or photo is known yet: a person, not a "?". */
function PersonGlyph() {
  return (
    <svg className="soft-avatar-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.75 19.25c1.3-3.3 4-5 7.25-5s5.95 1.7 7.25 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Team context stays visible; switching lives in Settings → Your teams. */
function TeamChip({ label, className }: { label: string; className: string }) {
  return <p className={className}><span>{label}</span></p>;
}

export function AppShellTopbar({
  showBack,
  onBack,
  isHubRoot,
  title,
  orgLabel,
  crumbHint,
  orgId,
  searchOpen,
  onOpenSearch,
  shortcutHint,
  minimal = false,

  unreadCount,
  accountMenuOpen,
  onToggleAccount,
  onCloseAccount,
  me,
  initial,
  accountLabel,
  memberships,
  rolePlanCue,
  signingOut,
  onSignOut,
}: {
  showBack: boolean;
  onBack: () => void;
  isHubRoot: boolean;
  title: string | null;
  orgLabel: string;
  crumbHint: string | null;
  orgId: string;
  /** Whether the search palette is showing. */
  searchOpen: boolean;
  /** Opens the search palette (⌘K / Ctrl+K does the same). */
  onOpenSearch: () => void;
  shortcutHint: string;
  /**
   * Onboarding: the logo and the account menu (for Sign out) only. The menu and search buttons
   * there led nowhere, and CSS hid only their icons, leaving an invisible 44×44 button.
   */
  minimal?: boolean;

  unreadCount: number;
  accountMenuOpen: boolean;
  onToggleAccount: () => void;
  onCloseAccount: () => void;
  me: Me;
  initial: string;
  accountLabel: string | null;
  memberships: MembershipOption[];
  /** "Owner · Team plan" for the team in view, shown in the account menu. */
  rolePlanCue: string | null;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  // View only (0715): say so once, calmly, so a refused button is never a surprise.
  const viewOnly = isViewOnlyIn(memberships, orgId, me.role);
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
            {/* Two patterns, no more. A page with a parent (Account, Help, Team admin) shows
                the back button and its name. Every other page shows the team switcher alone:
                its own breadcrumb and h1 already name it, and a title here made Safety, Hours,
                Learn and Pit say their name three times in 150px. */}
            {isHubRoot || !showBack ? (
              minimal ? (
                // Onboarding has no team to switch to yet: the chooser sent the person straight
                // back, which looked like the menu reloading the page.
                <p className="soft-topbar-title soft-topbar-org">{orgLabel}</p>
              ) : (
                <TeamChip
                  label={orgLabel}
                  className="soft-topbar-title soft-topbar-org"
                />
              )
            ) : (
              <>
                <p className="soft-topbar-title">{title ?? "Vantage"}</p>
                {/* The line under the title is the crumb. It can repeat the title — "6925"
                    over "6925" — which reads as a rendering bug rather than a hierarchy, so it
                    is dropped when it would only say the same thing again. */}
                {(() => {
                  const sub = crumbHint;
                  // A page with no menu entry has "Vantage" for both lines ("Vantage / Vantage"
                  // on Team security); the fallback crumb says nothing, so it is dropped.
                  if (!sub || sub.trim() === "Vantage") return null;
                  const heading = (title ?? "Vantage").trim().toLowerCase();
                  const crumb = sub.trim().toLowerCase();
                  // A crumb reading "Settings / Account" under a title reading
                  // "Account" ends in the word it sits beneath. Comparing the
                  // whole string missed that, so the page said its own name
                  // twice, one line apart.
                  const tail = crumb.split("/").pop()?.trim() ?? crumb;
                  if (crumb === heading || tail === heading) return null;
                  return <small className="soft-org-crumb">{sub}</small>;
                })()}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="soft-topbar-actions">
        {viewOnly ? (
          <span className="view-only-chip" title={VIEW_ONLY_CHIP_TITLE} aria-label={`View only. ${VIEW_ONLY_CHIP_TITLE}`}>
            View only
          </span>
        ) : null}
        {/* Search or ask: the one field for finding a tool, team data, or asking AI. On a phone it
            is the icon alone. */}
        {minimal ? null : <button className="app-topbar-search" data-tour="menu" type="button" onClick={onOpenSearch} aria-label="Search or ask AI" aria-haspopup="dialog" aria-expanded={searchOpen} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" /><span>Search or ask</span><kbd aria-hidden="true">{shortcutHint}</kbd></button>}
        {/* Nothing is queued before someone is on a team, and its 12-second check read /api/me,
            which answers 403 during onboarding. */}
        {minimal ? null : <ShellOutboxStatus orgId={orgId || null} />}
        <a
          className="soft-icon-btn soft-notif"
          href={withOrgHref("/notifications", orgId || null)}
          aria-label={unreadCount >= 1 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Icon name="bell" />
          {unreadCount >= 1 ? <b data-count={unreadCount}>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
        </a>
        <div className="soft-account-menu">
          <button
            className="soft-avatar soft-avatar-btn"
            type="button"
            data-tour="feedback"
            aria-label="Account menu"
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            aria-controls={accountMenuOpen ? "soft-account-menu" : undefined}
            onClick={onToggleAccount}
            onKeyDown={(event) => {
              // Arrow keys on a menu button open its menu (focus then lands on the first item).
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !accountMenuOpen) {
                event.preventDefault();
                onToggleAccount();
              }
            }}
          >
            {me.image ? <img src={me.image} alt="" /> : initial === "?" ? <PersonGlyph /> : initial}
          </button>
          <AppShellAccountMenu
            open={accountMenuOpen}
            me={me}
            accountLabel={accountLabel}
            orgId={orgId}
            rolePlanCue={rolePlanCue}
            minimal={minimal}
            signingOut={signingOut}
            onClose={onCloseAccount}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    </header>
  );
}
