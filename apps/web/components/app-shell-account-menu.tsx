"use client";

import { type Me, type MembershipOption } from "./app-shell-model";
import { withOrgHref } from "../lib/nav/product-nav";
import { Icon } from "./icon";

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
  if (!open) return null;
  return (
      <div
        className="soft-account-pop"
        role="menu"
        aria-label="Account"
        onClick={(event) => event.stopPropagation()}
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
          {/* The page it opens is titled Account; the menu said Settings. */}
          <Icon name="gear" /><span>Account and settings</span>
        </a>
        {/* One tap to the team for the people who run it; it took Account and settings first. */}
        {memberships.some((row) => row.orgId === orgId && (row.role === "owner" || row.role === "admin")) ? (
          <a className="soft-account-destination" role="menuitem" href={`/team/admin?orgId=${encodeURIComponent(orgId)}`} onClick={onClose}>
            <Icon name="users" /><span>Team admin</span>
          </a>
        ) : null}
        {/* The help centre keeps the manual, tickets and bug reporting together. */}
        <a className="soft-account-destination" role="menuitem" href={withOrgHref("/help", orgId)} onClick={onClose}>
          <Icon name="chat" /><span>Help and support</span>
        </a>
        {me.platformAdmin ? (
          <a role="menuitem" href="/admin" onClick={onClose}>
            Platform admin
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
