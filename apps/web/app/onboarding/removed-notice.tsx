"use client";

import { useEffect, useState } from "react";
import { clearFeatureSnapshotsForOrg } from "../../lib/offline/feature-cache";
import { isTeamRemoval, removalNoticeCopy, type TeamRemoval } from "../../lib/team/removal-notice";
import "./removed-notice.css";

/**
 * "You were removed from Team 9301", on the no-team screen. A member taken off a team used to
 * land on "Profile saved. Join your team next." with nothing about the removal (QA A3-15).
 * Also clears that team's downloaded views from this device (QA A3-19).
 */
export function RemovedFromTeamNotice() {
  const [removal, setRemoval] = useState<TeamRemoval | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/onboarding/removal", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { removal?: unknown };
        if (!active || !isTeamRemoval(data.removal)) return;
        setRemoval(data.removal);
        // Best effort: the team's Home and task snapshots should not outlive the membership.
        void clearFeatureSnapshotsForOrg(data.removal.orgId).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!removal) return null;
  const copy = removalNoticeCopy(removal);
  return (
    <p className="onboarding-removed-note" role="status">
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
    </p>
  );
}
