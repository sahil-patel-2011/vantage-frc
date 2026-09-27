"use client";

import { formatMembershipLabel, roleWord, type Me, type MembershipOption } from "./app-shell-model";
import { useEffect, useRef } from "react";
import { Icon } from "./icon";

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
  initialFocus = "first",
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
  initialFocus?: "first" | "last";
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const menu = menuRef.current;
    const items = menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
    (initialFocus === "last" ? items?.[items.length - 1] : items?.[0])?.focus();
    return () => { if (menu?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus(); };
  }, [open, initialFocus]);
  if (!open) return null;
  return (
      <div
        className="soft-account-pop"
        id="account-menu-popup"
        ref={menuRef}
        role="menu"
        aria-label="Account"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={event => {
          // Menu navigation must not also trigger app-wide letter shortcuts.
          event.stopPropagation();
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
          if (event.key === " " && index >= 0) { event.preventDefault(); items[index]?.click(); return; }
          if (event.key === "Tab") {
            event.preventDefault();
            const trigger = document.getElementById("account-menu-trigger");
            const outside = [...document.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
              .filter(node => !event.currentTarget.contains(node) && node.offsetParent !== null && getComputedStyle(node).visibility !== "hidden");
            const at = trigger ? outside.indexOf(trigger) : -1;
            const next = outside[at + (event.shiftKey ? -1 : 1)] ?? trigger;
            next?.focus(); onClose(); return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
            const next = [...items.slice(index + 1), ...items.slice(0, index + 1)]
              .find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
            if (next) { event.preventDefault(); next.focus(); }
          }
        }}
      >
        <div className="soft-account-pop-head">
          <span className="soft-account-identity-avatar" aria-hidden="true">{me.image ? <img src={me.image} alt="" /> : (accountLabel?.[0] ?? "V")}</span>
          <div><strong>{accountLabel ?? "Signed-in user"}</strong><span>{me.email ?? "Account"}</span></div>
        </div>
        <a role="menuitem" tabIndex={-1} href="/account" onClick={onClose}><Icon name="gear" /><span>Account and settings</span><Icon name="chevron" /></a>
        {memberships.length > 1 ? (
          <div className="soft-account-teams" role="group" aria-label="Switch team">
            <span className="soft-account-teams-label">Teams</span>
            {orderedMemberships.map((row) => (
              <a
                key={row.orgId}
                role="menuitem"
                tabIndex={-1}
                href={switchWorkspaceHref(row.orgId)}
                data-full-reload
                aria-current={row.orgId === orgId ? "true" : undefined}
                onClick={() => {
                  onWorkspaceSwitch(row.orgId);
                  onClose();
                }}
              >
                <Icon name="users" />
                <span><strong>{formatMembershipLabel(row)}</strong><small>
                  {roleWord(row.role)}
                  {recentOrgIds[0] === row.orgId && row.orgId !== orgId ? " · recent" : ""}
                </small></span>
                {row.orgId === orgId ? <span className="soft-account-selected" aria-label="Current team">✓</span> : <Icon name="chevron" />}
              </a>
            ))}
          </div>
        ) : <div className="soft-account-current-team"><strong>{orgLabel}</strong><small>{rolePlanCue}</small></div>}
        {/* Settings owns the canonical list (SETTINGS_NAV): profile,
            appearance, notifications, security, keys. Repeating two of
            its rows here meant this menu had two ways to /account. */}
        {/* One tap to the team for the people who run it; it took Account and settings first. */}
        {memberships.some((row) => row.orgId === orgId && (row.role === "owner" || row.role === "admin")) ? (
          <a role="menuitem" tabIndex={-1} href={`/team/admin?orgId=${encodeURIComponent(orgId)}`} onClick={onClose}>
            <Icon name="users" /><span>Team admin</span><Icon name="chevron" />
          </a>
        ) : null}
        <a role="menuitem" tabIndex={-1} href="/docs" onClick={onClose}>
          <Icon name="clipboard" /><span>App manual</span><Icon name="chevron" />
        </a>
        <a role="menuitem" tabIndex={-1} href="/support" onClick={onClose}>
          <Icon name="chat" /><span>Support tickets</span><Icon name="chevron" />
        </a>
        <a role="menuitem" tabIndex={-1} href="/report-bug" onClick={onClose}>
          <Icon name="activity" /><span>Report a bug</span><Icon name="chevron" />
        </a>
        {me.platformAdmin ? (
          <a role="menuitem" tabIndex={-1} href="/admin" onClick={onClose}>
            <Icon name="shield" /><span>Platform admin</span><Icon name="chevron" />
          </a>
        ) : null}
        <button
          role="menuitem"
          tabIndex={-1}
          type="button"
          className="soft-account-signout"
          disabled={signingOut}
          onClick={onSignOut}
        >
          <Icon name="logout" /><span>{signingOut ? "Signing out…" : "Sign out"}</span>
        </button>
      </div>
  );
}
