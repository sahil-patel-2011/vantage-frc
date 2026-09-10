"use client";

import { githubConnectionHref } from "../../../lib/github/github-related";
import type { GitHubCalendarOverlay } from "../../../lib/subteam-calendar";

export function GitHubCalendarHint({
  overlay,
  orgId,
}: {
  overlay: GitHubCalendarOverlay | undefined;
  orgId: string;
}) {
  const href = githubConnectionHref(orgId);
  if (!overlay) return null;
  if (!overlay.connected) {
    return (
      <p className="tc-github-hint">
        <a href={href}>Connect GitHub</a> to show milestone due dates.
      </p>
    );
  }
  if (!overlay.repo) {
    return (
      <p className="tc-github-hint">
        <a href={href}>Pick a default repo</a> for milestone due dates.
      </p>
    );
  }
  return null;
}
