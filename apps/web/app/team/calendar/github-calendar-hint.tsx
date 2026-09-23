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
  if (!overlay.connected) {
    if (!canManage) {
      return (
        <p className="tc-github-hint">
          An owner or admin connects GitHub before milestone due dates show up here.
        </p>
      );
    }
    return (
      <p className="tc-github-hint">
        <a href={href}>Connect GitHub</a> to show milestone due dates.
      </p>
    );
  }
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
