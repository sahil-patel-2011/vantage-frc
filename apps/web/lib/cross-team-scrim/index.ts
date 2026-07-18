import type { ScrimDataShareScope, ScrimInvite, ScrimStatus, ScrimSummary } from "./types";

export * from "./types";

const STATUS_LABELS: Record<ScrimStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  declined: "Declined",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

const DATA_SHARE_LABELS: Record<ScrimDataShareScope, string> = {
  none: "No data sharing",
  match_results: "Match results only",
  full_scouting: "Full scouting data",
  video_only: "Video only",
};

export function scrimStatusLabel(status: ScrimStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function scrimDataShareLabel(scope: ScrimDataShareScope): string {
  return DATA_SHARE_LABELS[scope] ?? scope;
}

const OPEN_STATUSES: ScrimStatus[] = ["proposed", "accepted", "scheduled"];

/** Summarize a set of scrim invites — pure, no I/O. Skips nothing; every row counts once. */
export function summarizeScrimInvites(invites: ScrimInvite[], now: Date = new Date()): ScrimSummary {
  const byStatusMap = new Map<ScrimStatus, number>();
  let agreedDataShareCount = 0;
  let upcomingCount = 0;
  const today = now.toISOString().slice(0, 10);

  for (const invite of invites) {
    byStatusMap.set(invite.status, (byStatusMap.get(invite.status) ?? 0) + 1);
    if (invite.dataShareAgreed) agreedDataShareCount += 1;
    if (
      OPEN_STATUSES.includes(invite.status) &&
      invite.proposedDate != null &&
      invite.proposedDate >= today
    ) {
      upcomingCount += 1;
    }
  }

  const byStatus = Array.from(byStatusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: invites.length,
    byStatus,
    agreedDataShareCount,
    upcomingCount,
  };
}

/** Upcoming/open invites sorted by nearest proposed date first (undated last). */
export function upcomingScrimInvites(invites: ScrimInvite[]): ScrimInvite[] {
  return invites
    .filter((invite) => OPEN_STATUSES.includes(invite.status))
    .slice()
    .sort((a, b) => {
      if (a.proposedDate == null && b.proposedDate == null) return 0;
      if (a.proposedDate == null) return 1;
      if (b.proposedDate == null) return -1;
      return a.proposedDate.localeCompare(b.proposedDate);
    });
}
