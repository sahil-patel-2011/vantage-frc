"use client";

import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useDashboardActions } from "./dashboard-quick-actions";
import { scoutingHomeAction } from "./dashboard-overview-model";

/** Launch the existing tools; task creation stays in the saved board's action provider. */
export function DashboardWorkspaceActions({ orgId, role, hasEvent, hasForms }: {
  orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean;
}) {
  const actions = useDashboardActions();
  const canCreate = Boolean(actions && role && role !== "viewer");
  const scouting = scoutingHomeAction({ orgId, role, hasEvent, hasForms });
  return (
    <nav className="dash-workspace-actions" aria-label="Quick actions" data-testid="dash-workspace-actions">
      <h2>Make it happen</h2>
      <div className="dash-workspace-action-grid">
        {canCreate ? (
          <button type="button" className="dash-workspace-action" onClick={() => actions?.open("task")}>
            <i data-tone="blue"><Icon name="clipboard" /></i>
            <span><strong>Add a task</strong><small>Give the next step a home</small></span>
            <span className="dash-workspace-plus" aria-hidden="true">+</span>
          </button>
        ) : (
          <a className="dash-workspace-action" href={withOrgHref("/todos", orgId)}>
            <i data-tone="blue"><Icon name="clipboard" /></i>
            <span><strong>Team tasks</strong><small>See what needs doing</small></span>
            <Icon name="chevron" />
          </a>
        )}
        <a className="dash-workspace-action" href={scouting.href}>
          <i data-tone="purple"><Icon name="scout" /></i>
          <span><strong>{scouting.label}</strong><small>{role === "viewer" ? "Get to know the field" : "Collect your next insight"}</small></span>
          <Icon name="chevron" />
        </a>
        <a className="dash-workspace-action" href={withOrgHref("/team?tab=calendar", orgId)}>
          <i data-tone="orange"><Icon name="calendar" /></i>
          <span><strong>Calendar</strong><small>Plan your team’s week</small></span>
          <Icon name="chevron" />
        </a>
        <a className="dash-workspace-action" href={withOrgHref("/hours-self-view", orgId)}>
          <i data-tone="green"><Icon name="activity" /></i>
          <span><strong>My hours</strong><small>Make your time count</small></span>
          <Icon name="chevron" />
        </a>
      </div>
    </nav>
  );
}
