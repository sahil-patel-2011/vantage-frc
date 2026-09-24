"use client";

import { githubConnectionHref } from "../../../lib/github/github-related";
import type { GitHubCalendarOverlay } from "../../../lib/subteam-calendar";

export function GitHubCalendarHint({
  overlay,
  orgId,
  canManage,
}: {
  overlay: GitHubCalendarOverlay | undefined;
  orgId: string;
  canManage: boolean;
}) {
  const href = githubConnectionHref(orgId);
  if (!overlay) return null;
  // A team that never connected GitHub was asked to, above the calendar of a brand-new team,
  // before it had added a single practice. The prompt lives with Connectors; here it only
  // helps a team that has GitHub and still needs a repo picked.
  if (!overlay.connected) return null;
  if (!overlay.repo) {
    if (!canManage) {
      return (
        <p className="tc-github-hint">
          An owner or admin picks the default repo before milestone due dates show up here.
        </p>
      );
    }
    return (
      <p className="tc-github-hint">
        <a href={href}>Pick a default repo</a> for milestone due dates.
      </p>
    );
  }
  return null;
}
