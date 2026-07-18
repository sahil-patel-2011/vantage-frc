import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import {
  coverageGapFingerprint,
  coverageGapMessage,
  type CoverageBoardCell,
} from "./match-coverage";

export type CoverageNudgeResult = {
  status: "skipped" | "sent" | "throttled" | "no_gaps" | "forbidden";
  missingRows: number;
  emitted: number;
  fingerprint: string | null;
  message?: string;
};

const COOLDOWN_MINUTES = 15;

/**
 * Mid-event nudge to scout coordinators (owners/admins) when upcoming match rows
 * are uncovered. Dedupes on fingerprint so Command polling does not spam.
 * Actor must be owner/admin (RLS insert policy).
 */
export async function maybeNotifyCoverageGaps(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string;
    actorUserId: string;
    actorRole: string | null;
    board: CoverageBoardCell[];
  },
): Promise<CoverageNudgeResult> {
  const missing = input.board.filter((cell) => cell.state === "missing");
  if (!missing.length) {
    return { status: "no_gaps", missingRows: 0, emitted: 0, fingerprint: null };
  }
  if (!["owner", "admin"].includes(input.actorRole ?? "")) {
    return {
      status: "forbidden",
      missingRows: missing.length,
      emitted: 0,
      fingerprint: coverageGapFingerprint(missing),
    };
  }

  const fingerprint = coverageGapFingerprint(missing);
  const recent = await client.query<{ fingerprint: string | null }>(
    `SELECT payload->>'fingerprint' AS fingerprint
     FROM notifications
     WHERE org_id = $1::uuid
       AND type = 'scouting_coverage_gap'
       AND created_at > now() - ($2::text || ' minutes')::interval
       AND coalesce(payload->>'eventKey', '') = $3
     ORDER BY created_at DESC
     LIMIT 12`,
    [input.orgId, String(COOLDOWN_MINUTES), input.eventKey],
  );
  if (recent.rows.some((row) => row.fingerprint === fingerprint)) {
    return { status: "throttled", missingRows: missing.length, emitted: 0, fingerprint };
  }

  const message = coverageGapMessage({
    eventKey: input.eventKey,
    missing: missing.length,
    sample: missing,
  });
  const href = `/command?orgId=${encodeURIComponent(input.orgId)}`;
  const recipients = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId"
     FROM memberships
     WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [input.orgId],
  );

  let emitted = 0;
  for (const recipient of recipients.rows) {
    const result = await emitPreferredNotification(client, {
      userId: recipient.userId,
      orgId: input.orgId,
      type: "scouting_coverage_gap",
      payload: {
        title: "Scouting coverage gap",
        message,
        body: message,
        eventKey: input.eventKey,
        fingerprint,
        missingRows: missing.length,
        href,
      },
    });
    if (result.emitted) emitted += 1;
  }

  return {
    status: emitted > 0 ? "sent" : "skipped",
    missingRows: missing.length,
    emitted,
    fingerprint,
    message,
  };
}
