"use client";

import { useEffect, useRef } from "react";
import { type Me, type MembershipOption } from "./app-shell-model";
import { withOrgHref } from "../lib/nav/product-nav";
import { Icon } from "./icon";
import { FeedbackBugIcon } from "./feedback-bug-icon";
import { openFeedback } from "../lib/feedback/feedback-open";
import { tourReplayHref } from "../lib/tour/tour-start";

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')] : [];
}

/** Where focus goes for a key in a vertical menu: arrows wrap, Home and End jump; null = not ours. */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function AppShellAccountMenu({
  open,
  me,
  accountLabel,
  orgLabel,
  rolePlanCue,
  orgId,
  memberships,
  signingOut,
  onClose,
  onSignOut,
}: {
  open: boolean;
  me: Me;
  accountLabel: string | null;
  orgLabel: string;
  rolePlanCue: string;
  orgId: string;
  memberships: MembershipOption[];
  orderedMemberships: MembershipOption[];
  recentOrgIds: string[];
  signingOut: boolean;
  onClose: () => void;
  switchWorkspaceHref: (nextOrgId: string) => string;
  onWorkspaceSwitch: (nextOrgId: string) => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // A menu promises that focus moves into it: it stayed on the avatar, so the items were only
  // reachable by tabbing past them blind. Opening puts focus on the first item.
  useEffect(() => {
    if (open) menuItems(menuRef.current)[0]?.focus();
  }, [open]);
  if (!open) return null;
  return (
      <div
        ref={menuRef}
        id="soft-account-menu"
        className="soft-account-pop"
        role="menu"
        aria-label="Account"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const items = menuItems(menuRef.current);
          const at = items.indexOf(document.activeElement as HTMLElement);
          const move = nextMenuIndex(event.key, at, items.length);
          if (move !== null) {
            event.preventDefault();
            items[move]?.focus();
            return;
          }
          // Escape and Tab close the menu and hand focus back to the avatar that opened it
          // (closing removes the focused item, which would otherwise drop focus on <body>).
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            onClose();
            document.querySelector<HTMLButtonElement>(".soft-avatar-btn")?.focus();
          }
        }}
      >
        <div className="soft-account-pop-head">
          <strong>{accountLabel ?? "Signed-in user"}</strong>
          <span>{me.email ?? "Account"}</span>
          <div className="soft-account-context">
            <span className="soft-account-org" title={orgLabel}>{orgLabel}</span>
            <span className="soft-account-role">{rolePlanCue}</span>
          </div>
        </div>
        {/* Settings owns the canonical list (SETTINGS_NAV): profile,
            appearance, notifications, security, keys. Repeating two of
            its rows here meant this menu had two ways to /account. */}
        <a className="soft-account-destination" role="menuitem" href={withOrgHref("/account", orgId)} onClick={onClose}>
          {/* The page it opens is titled Account, and the sidebar and menu panel say Account too. */}
          <Icon name="gear" /><span>Account</span>
        </a>
        {/* One tap to the team for the people who run it; it took Account first. */}
        {memberships.some((row) => row.orgId === orgId && (row.role === "owner" || row.role === "admin")) ? (
          <a className="soft-account-destination" role="menuitem" href={`/team/admin?orgId=${encodeURIComponent(orgId)}`} onClick={onClose}>
            <Icon name="users" /><span>Team admin</span>
          </a>
        ) : null}
        {/* The help centre keeps the manual, tickets and bug reporting together. */}
        <a className="soft-account-destination" role="menuitem" href={withOrgHref("/help", orgId)} onClick={onClose}>
          <Icon name="book" /><span>Help</span>
        </a>
        {/* The same dialog as the round bug button in the corner (components/feedback-button.tsx). */}
        <button
          className="soft-account-destination"
          role="menuitem"
          type="button"
          onClick={() => {
            onClose();
            openFeedback();
          }}
        >
          <FeedbackBugIcon size={18} /><span>Send feedback</span>
        </button>
        {/* Home with ?tour=replay: the tour starts there whatever it remembers (components/app-tour.tsx). */}
        <a className="soft-account-destination" role="menuitem" href={tourReplayHref(orgId)} onClick={onClose}>
          <Icon name="play" /><span>Take the tour again</span>
        </a>
        {me.platformAdmin ? (
          <a className="soft-account-destination" role="menuitem" href="/admin" onClick={onClose}>
            <Icon name="shield" /><span>Platform admin</span>
          </a>
        ) : null}
        <button
          role="menuitem"
          type="button"
          className="soft-account-signout"
          disabled={signingOut}
          onClick={onSignOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
  );
}
