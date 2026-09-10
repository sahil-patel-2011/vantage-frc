"use client";

import { Button } from "../../components/ui";
import type { TeamAdminNextAction } from "../../lib/team/team-admin-related";

export function MembershipNextActionsPanel({ actions }: { actions: TeamAdminNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel team-admin-next-actions" aria-label="Membership next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
