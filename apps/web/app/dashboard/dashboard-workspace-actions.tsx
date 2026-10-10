"use client";

import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useDashboardActions } from "./dashboard-quick-actions";
import { sameHomeDestination, scoutingHomeAction } from "./dashboard-overview-model";

/** Launch the existing tools; task creation stays in the saved board's action provider. */
export function DashboardWorkspaceActions({ orgId, role, hasEvent, hasForms, primaryHref, hasTaskCard = false }: {
  orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean;
  primaryHref?: string;
  hasTaskCard?: boolean;
}) {
  const actions = useDashboardActions();
  const canCreate = Boolean(actions && role && role !== "viewer");
  const scouting = scoutingHomeAction({ orgId, role, hasEvent, hasForms });
  const showTask = !hasTaskCard && (canCreate || !primaryHref || !sameHomeDestination(primaryHref, "/todos"));
  const showScout = !primaryHref || !sameHomeDestination(primaryHref, scouting.href);
  if (!showTask && !showScout) return null;
  return (
    <nav className="dash-workspace-actions" aria-label="Quick actions" data-testid="dash-workspace-actions">
      <div className="dash-workspace-action-grid">
        {showTask && canCreate ? (
          <button type="button" className="dash-workspace-action" onClick={() => actions?.open("task")}>
            <Icon name="clipboard" />
            <span>Add a task</span>
          </button>
        ) : showTask ? (
          <a className="dash-workspace-action" href={withOrgHref("/todos", orgId)}>
            <Icon name="clipboard" />
            <span>Team tasks</span>
          </a>
        ) : null}
        {showScout ? <a className="dash-workspace-action" href={scouting.href}>
          <Icon name="scout" />
          <span>{scouting.label}</span>
        </a> : null}
      </div>
    </nav>
  );
}
