"use client";

import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useDashboardActions } from "./dashboard-quick-actions";
import { sameHomeDestination, scoutingHomeAction } from "./dashboard-overview-model";

/** Launch the existing tools; task creation stays in the saved board's action provider. */
export function DashboardWorkspaceActions({ orgId, role, hasEvent, hasForms, primaryHref }: {
  orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean;
  primaryHref?: string;
}) {
  const actions = useDashboardActions();
  const canCreate = Boolean(actions && role && role !== "viewer");
  const scouting = scoutingHomeAction({ orgId, role, hasEvent, hasForms });
  return (
    <nav className="dash-workspace-actions" aria-label="Quick actions" data-testid="dash-workspace-actions">
      <div className="dash-workspace-action-grid">
        {canCreate ? (
          <button type="button" className="dash-workspace-action" onClick={() => actions?.open("task")}>
            <Icon name="clipboard" />
            <span>Add a task</span>
          </button>
        ) : !primaryHref || !sameHomeDestination(primaryHref, "/todos") ? (
          <a className="dash-workspace-action" href={withOrgHref("/todos", orgId)}>
            <Icon name="clipboard" />
            <span>Team tasks</span>
          </a>
        ) : null}
        {!primaryHref || !sameHomeDestination(primaryHref, scouting.href) ? <a className="dash-workspace-action" href={scouting.href}>
          <Icon name="scout" />
          <span>{scouting.label}</span>
        </a> : null}
      </div>
    </nav>
  );
}
