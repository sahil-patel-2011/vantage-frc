"use client";


import type { TeamAdminNextAction } from "../../lib/team/team-admin-related";

export function MembershipNextActionsPanel({ actions }: { actions: TeamAdminNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel team-admin-next-actions" aria-label="Membership next actions">
      <header>
        <h2>Next actions</h2>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
