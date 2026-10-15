"use client";

import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useDashboardActions } from "./dashboard-quick-actions";
import { sameHomeDestination, scoutingHomeAction } from "./dashboard-overview-model";

/** Launch the existing tools; task creation stays in the saved board's action provider. */
export function DashboardWorkspaceActions({ orgId, role, hasEvent, hasForms, primaryHref, setupHrefs = [], hasTaskCard = false }: {
  orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean;
  primaryHref?: string;
  /** Where the open setup steps on Home already lead. */
  setupHrefs?: readonly string[];
  hasTaskCard?: boolean;
}) {
  const actions = useDashboardActions();
  const canCreate = Boolean(actions && role && role !== "viewer");
  const scouting = scoutingHomeAction({ orgId, role, hasEvent, hasForms });
  // A shortcut to somewhere Home already offers a way into is the same destination twice:
  // "Set up scouting" sat beside the setup step "Set up your scouting form".
  const covered = [primaryHref, ...setupHrefs].filter((href): href is string => Boolean(href));
  const elsewhere = (href: string) => covered.some((taken) => sameHomeDestination(taken, href));
  const showTask = !hasTaskCard && (canCreate || !elsewhere("/todos"));
  const showScout = !elsewhere(scouting.href);
  if (!showTask && !showScout) return null;
  // One shortcut on its own was a lone button in a row of its own under the Up next card. It
  // reads as a quiet link tucked under that card instead of a second, orphaned action.
  if (showScout && !showTask) {
    return (
      <nav className="dash-workspace-actions is-single" aria-label="Quick actions" data-testid="dash-workspace-actions">
        <a className="dash-now-quiet" href={scouting.href}>{scouting.label} →</a>
      </nav>
    );
  }
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
            <span>Tasks</span>
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
