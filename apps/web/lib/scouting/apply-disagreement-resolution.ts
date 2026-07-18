import type { PoolClient } from "@neondatabase/serverless";
import { emitNotification } from "@vantage/core";
import {
  buildChoseScoutResolution,
  buildDismissResolution,
  validateResolution,
} from "@vantage/scouting";
import { confidenceAdjustmentsForResolution } from "@vantage/scouting/trust";

export type DisagreementReviewStatus = "resolved" | "dismissed";

export type DisagreementResolutionInput = {
  orgId: string;
  disagreementId: string;
  reviewerUserId: string;
  status: DisagreementReviewStatus;
  winningEntryId?: string | null;
  note?: string | null;
};

export type DisagreementResolutionResult = {
  ok: true;
  disagreementId: string;
  status: DisagreementReviewStatus;
  trustAdjustments: number;
  coordinatorsNotified: number;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  fieldKey: string;
  winningScoutName: string | null;
};

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** Record which scout was right, adjust confidence, append audit, notify coordinators. */
export async function applyDisagreementResolution(
  client: PoolClient,
  input: DisagreementResolutionInput,
): Promise<DisagreementResolutionResult> {
  const existing = await client.query<{
    id: string;
    eventKey: string;
    matchKey: string;
    teamKey: string;
    fieldKey: string;
    entryIds: string[];
    values: unknown;
    status: string;
    resolution: Record<string, unknown> | null;
    winningEntryId: string | null;
    winningScoutUserId: string | null;
    chosenValue: unknown;
  }>(
    `SELECT id, event_key AS "eventKey", match_key AS "matchKey", team_key AS "teamKey",
            field_key AS "fieldKey", entry_ids AS "entryIds", values, status,
            resolution, winning_entry_id AS "winningEntryId",
            winning_scout_user_id AS "winningScoutUserId", chosen_value AS "chosenValue"
     FROM scout_disagreements
     WHERE id = $1::uuid AND org_id = $2::uuid
     FOR UPDATE`,
    [input.disagreementId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Disagreement not found");
  if (row.status !== "open") throw new Error("Disagreement already reviewed");

  const note = text(input.note, 500);
  let winningEntryId: string | null = null;
  let winningScoutUserId: string | null = null;
  let chosenValue: unknown = null;
  let winningScoutName: string | null = null;
  let structured;

  if (input.status === "dismissed") {
    structured = buildDismissResolution({ note: note || undefined, reviewedIn: "api" });
  } else {
    winningEntryId = text(input.winningEntryId, 64) || null;
    if (!winningEntryId) throw new Error("Pick which scout was right before resolving");
    if (!row.entryIds.includes(winningEntryId)) {
      throw new Error("Winning entry is not part of this disagreement");
    }
    const scout = await client.query<{ scoutUserId: string; scoutName: string }>(
      `SELECT e.scout_user_id::text AS "scoutUserId",
              COALESCE(u.name, u.email, 'Scout') AS "scoutName"
       FROM match_scout_entries e
       LEFT JOIN users u ON u.id = e.scout_user_id
       WHERE e.id = $1::uuid AND e.org_id = $2::uuid`,
      [winningEntryId, input.orgId],
    );
    const winner = scout.rows[0];
    if (!winner) throw new Error("Winning scout entry not found");
    winningScoutUserId = winner.scoutUserId;
    winningScoutName = winner.scoutName;
    const index = row.entryIds.indexOf(winningEntryId);
    chosenValue =
      index >= 0 && Array.isArray(row.values) ? (row.values[index] ?? null) : null;
    structured = buildChoseScoutResolution({
      entryId: winningEntryId,
      scoutUserId: winningScoutUserId,
      scoutName: winner.scoutName,
      value: chosenValue,
      note: note || undefined,
      reviewedIn: "api",
    });
    const validationError = validateResolution(structured, row.entryIds);
    if (validationError) throw new Error(validationError);
  }

  const resolutionPayload = {
    ...structured,
    reviewedIn: "scouting-disagreement-resolution",
    trustWeightsUpdated: input.status === "resolved" && Boolean(winningEntryId),
  };

  const before = {
    status: row.status,
    resolution: row.resolution,
    winningEntryId: row.winningEntryId,
    winningScoutUserId: row.winningScoutUserId,
    chosenValue: row.chosenValue,
  };

  const updated = await client.query(
    `UPDATE scout_disagreements
     SET status = $1,
         resolution = $2::jsonb,
         winning_entry_id = $3::uuid,
         winning_scout_user_id = $4::uuid,
         chosen_value = $5::jsonb,
         reviewed_by = $6::uuid,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $7::uuid AND org_id = $8::uuid AND status = 'open'
     RETURNING id`,
    [
      input.status,
      JSON.stringify(resolutionPayload),
      winningEntryId,
      winningScoutUserId,
      JSON.stringify(chosenValue ?? null),
      input.reviewerUserId,
      input.disagreementId,
      input.orgId,
    ],
  );
  if (!updated.rowCount) throw new Error("Disagreement already reviewed");

  await client.query(
    `INSERT INTO scout_disagreement_audit
      (org_id, disagreement_id, actor_user_id, action, before, after)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb)`,
    [
      input.orgId,
      input.disagreementId,
      input.reviewerUserId,
      input.status,
      JSON.stringify(before),
      JSON.stringify({
        status: input.status,
        resolution: resolutionPayload,
        winningEntryId,
        winningScoutUserId,
        chosenValue,
      }),
    ],
  );

  const adjustments = confidenceAdjustmentsForResolution({
    entryIds: row.entryIds,
    winningEntryId,
    status: input.status,
  });
  for (const adjustment of adjustments) {
    await client.query(
      `UPDATE match_scout_entries
       SET confidence = $1::scout_confidence, updated_at = now()
       WHERE id = $2::uuid AND org_id = $3::uuid`,
      [adjustment.confidence, adjustment.entryId, input.orgId],
    );
  }

  const coordinators = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId"
     FROM memberships
     WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [input.orgId],
  );
  const subject = `${row.matchKey} · ${row.teamKey} · ${row.fieldKey}`;
  const message =
    input.status === "resolved"
      ? winningScoutName
        ? `Disagreement resolved for ${subject}. ${winningScoutName} was right — pick-desk/strategy trust updated.`
        : `Disagreement resolved for ${subject}. Pick-desk/strategy trust updated.`
      : `Disagreement dismissed for ${subject}.`;
  let coordinatorsNotified = 0;
  for (const coordinator of coordinators.rows) {
    await emitNotification(client, {
      userId: coordinator.userId,
      orgId: input.orgId,
      type: "scouting_disagreement_resolved",
      payload: {
        title:
          input.status === "resolved"
            ? "Scout disagreement resolved"
            : "Scout disagreement dismissed",
        message,
        eventKey: row.eventKey,
        matchKey: row.matchKey,
        teamKey: row.teamKey,
        fieldKey: row.fieldKey,
        disagreementId: input.disagreementId,
        status: input.status,
        winningEntryId,
        winningScoutUserId,
        winningScoutName,
        trustAdjustments: adjustments.length,
        href: `/competition?tab=scouting&orgId=${encodeURIComponent(input.orgId)}&scoutTab=conflicts`,
      },
    });
    coordinatorsNotified += 1;
  }

  return {
    ok: true,
    disagreementId: input.disagreementId,
    status: input.status,
    trustAdjustments: adjustments.length,
    coordinatorsNotified,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    teamKey: row.teamKey,
    fieldKey: row.fieldKey,
    winningScoutName,
  };
}
