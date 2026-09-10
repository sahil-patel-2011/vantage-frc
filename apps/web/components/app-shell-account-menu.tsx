"use client";

import { formatMembershipLabel, type Me, type MembershipOption } from "./app-shell-model";

export function AppShellAccountMenu({
  open,
  me,
  accountLabel,
  orgLabel,
  rolePlanCue,
  orgId,
  memberships,
  orderedMemberships,
  recentOrgIds,
  signingOut,
  onClose,
  switchWorkspaceHref,
  onWorkspaceSwitch,
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
          <span className="soft-account-org">{orgLabel}</span>
          <span className="soft-account-org">{rolePlanCue}</span>
        </div>
        {memberships.length > 1 ? (
          <div className="soft-account-teams" role="group" aria-label="Switch team">
            <span className="soft-account-teams-label">Teams</span>
            {orderedMemberships.map((row) => (
              <a
                key={row.orgId}
                role="menuitem"
                href={switchWorkspaceHref(row.orgId)}
                aria-current={row.orgId === orgId ? "true" : undefined}
                onClick={() => {
                  onWorkspaceSwitch(row.orgId);
                  onClose();
                }}
              >
                {formatMembershipLabel(row)}
                <small>
                  {row.role ?? "member"}
                  {recentOrgIds[0] === row.orgId && row.orgId !== orgId ? " · recent" : ""}
                </small>
              </a>
            ))}
          </div>
        ) : null}
        {/* Settings owns the canonical list (SETTINGS_NAV): profile,
            appearance, notifications, security, keys. Repeating two of
            its rows here meant this menu had two ways to /account. */}
        <a role="menuitem" href="/account" onClick={onClose}>
          Settings
        </a>
        <a role="menuitem" href="/docs" onClick={onClose}>
          App manual
        </a>
        <a role="menuitem" href="/support" onClick={onClose}>
          Support tickets
        </a>
        <a role="menuitem" href="/report-bug" onClick={onClose}>
          Report a bug
        </a>
        {me.platformAdmin ? (
          <a role="menuitem" href="/admin" onClick={onClose}>
            Global Team Manager
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
