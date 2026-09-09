// Chemistry partner-fit → the ONE pick list.
//
// Chemistry could score an alliance and suggest third seats, and then the answer went nowhere:
// the "Try high-EPA seats" list said in so many words "Not a pick list". A team had to retype the
// numbers into Strategy. This promotes those candidates onto pick_lists / pick_list_entries
// (migration 0454) through lib/picklist/store.ts, so the same rows reach the pick desk, Pick
// Clock and the draft board. There is no chemistry_* island table.
//
// Every write goes through the store: RLS, the teams_ref existence check, dense rank
// renormalization and revision bumps all stay in exactly one place.
// Notes / justifications carry MODEL partner-fit only when a real score exists — never DEMO.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepointOrThrow } from "@vantage/db";
import {
  ensurePickList,
  isPickBucket,
  listPickLists,
  normalizeTeamKey,
  setJustification,
  upsertEntry,
  type JustificationSource,
  type PickBucket,
} from "../picklist";

export const CHEMISTRY_PROMOTE_ACTIONS = [
  "save-to-pick-list",
  "promote",
  "promote-partner-fit",
] as const;

export type ChemistryPromoteAction = (typeof CHEMISTRY_PROMOTE_ACTIONS)[number];

/** Real MODEL partner-fit only. `score` stays null until event metrics exist — never DEMO. */
export type PartnerFitContext = {
  score: number | null;
  modelVersion?: string | null;
  complementarity?: number | null;
  totalEpa?: number | null;
  reliabilityBlend?: number | null;
  eventKey?: string | null;
  allianceTeamKeys?: string[];
};

export type PromoteResult = {
  pickListId: string;
  /** Team keys actually written, in the order they were promoted. */
  promoted: string[];
  /** Inputs that were not valid team numbers — reported, never silently dropped. */
  rejected: string[];
  bucket: PickBucket;
  message: string;
};

export function isChemistryPromoteAction(value: unknown): value is ChemistryPromoteAction {
  return (
    typeof value === "string" &&
    (CHEMISTRY_PROMOTE_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Normalize a mixed bag of "254", "frc254", " 1323 " into canonical team keys, de-duplicated and
 * order-preserving. Pure so the parsing rules are testable without a database.
 */
export function normalizeShortlist(
  raw: Array<string | number | null | undefined>,
  limit = 12,
): { teamKeys: string[]; rejected: string[] } {
  const teamKeys: string[] = [];
  const rejected: string[] = [];
  for (const value of raw) {
    if (value == null || value === "") continue;
    const key = normalizeTeamKey(value);
    if (!key) {
      rejected.push(String(value).trim().slice(0, 16));
      continue;
    }
    if (!teamKeys.includes(key)) teamKeys.push(key);
  }
  return { teamKeys: teamKeys.slice(0, limit), rejected };
}

export function bucketOrDefault(value: unknown, fallback: PickBucket = "unranked"): PickBucket {
  return isPickBucket(value) ? value : fallback;
}

function finiteScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Honest partner-fit notes for a pick-list row. Returns null when there is no real MODEL score
 * and no caller note — never invents DEMO fit numbers.
 */
export function partnerFitNotes(input: {
  fit?: PartnerFitContext | null;
  notes?: string | null;
}): string | null {
  const parts: string[] = [];
  const caller = input.notes?.trim();
  if (caller && !/\bDEMO\b/i.test(caller)) parts.push(caller);

  const score = finiteScore(input.fit?.score);
  if (score != null) {
    const version = (input.fit?.modelVersion ?? "alliance-chemistry-v1").trim() || "alliance-chemistry-v1";
    const extras: string[] = [];
    if (input.fit?.complementarity != null && Number.isFinite(input.fit.complementarity)) {
      extras.push(`role fit ${Math.round(input.fit.complementarity)}`);
    }
    if (input.fit?.totalEpa != null && Number.isFinite(input.fit.totalEpa)) {
      extras.push(`EPA ${input.fit.totalEpa}`);
    }
    parts.push(
      `Chemistry MODEL ${version}: ${score}/100 partner fit${
        extras.length ? ` (${extras.join(", ")})` : ""
      }. Not a TBA pick fact.`,
    );
  }

  return parts.length ? parts.join(" ") : null;
}

/**
 * Spine justification for a real MODEL score. Null when chemistry could not score — the pick
 * desk stays empty of invented reasons rather than showing DEMO fit.
 */
export function partnerFitJustification(
  fit?: PartnerFitContext | null,
): { rationale: string; sources: JustificationSource[] } | null {
  const score = finiteScore(fit?.score);
  if (score == null) return null;
  const version = (fit?.modelVersion ?? "alliance-chemistry-v1").trim() || "alliance-chemistry-v1";
  const alliance = (fit?.allianceTeamKeys ?? [])
    .map((key) => key.replace(/^frc/i, ""))
    .filter(Boolean)
    .join(", ");
  const extras: string[] = [];
  if (fit?.complementarity != null && Number.isFinite(fit.complementarity)) {
    extras.push(`role fit ${Math.round(fit.complementarity)}`);
  }
  if (fit?.reliabilityBlend != null && Number.isFinite(fit.reliabilityBlend)) {
    extras.push(`scout reliability ${Math.round(fit.reliabilityBlend)}%`);
  }
  const rationale = `Alliance chemistry MODEL ${version}: ${score}/100 partner fit${
    extras.length ? ` — ${extras.join(", ")}` : ""
  }${alliance ? ` for ${alliance}` : ""}. Verify with pit notes before locking the pick — not a TBA fact.`;
  return {
    rationale,
    sources: [
      {
        kind: "chemistry",
        label: "Alliance chemistry MODEL",
        detail: `${version} scored ${score}/100 from synced event EPA and scout reliability — never a TBA pick fact.`,
      },
    ],
  };
}

/**
 * Attach partner-fit only when every requested seat is part of the scored alliance.
 * A high-EPA suggestion is not the same alliance — do not stamp that alliance's score on it.
 */
export function shouldAttachPartnerFit(requestedKeys: string[], scoredKeys: string[]): boolean {
  return requestedKeys.length > 0 && requestedKeys.every((key) => scoredKeys.includes(key));
}

/** Pull MODEL fit from a chemistry view. Null score stays null — never DEMO. */
export function partnerFitFromView(view: {
  teamKeys?: string[];
  eventKey?: string | null;
  chemistry?: {
    score: number | null;
    modelVersion?: string | null;
    complementarity?: number | null;
    totalEpa?: number | null;
    reliabilityBlend?: number | null;
  } | null;
} | null): PartnerFitContext | null {
  const chemistry = view?.chemistry;
  if (!chemistry) return null;
  return {
    score: finiteScore(chemistry.score),
    modelVersion: chemistry.modelVersion ?? "alliance-chemistry-v1",
    complementarity: chemistry.complementarity ?? null,
    totalEpa: chemistry.totalEpa ?? null,
    reliabilityBlend: chemistry.reliabilityBlend ?? null,
    eventKey: view?.eventKey ?? null,
    allianceTeamKeys: view?.teamKeys ?? [],
  };
}

/**
 * The list Chemistry writes to.
 *
 * listPickList / the pick desk / Pick Clock resolve "the" list as the most recently touched
 * list for the event. Going straight to ensurePickList() would mint a second list named
 * "Pick list" next to the one the desk is looking at — the exact island this spine removed.
 * A brand-new list is sourced `chemistry` (migration 0510). An existing event list is joined
 * as-is — its source is not rewritten.
 */
export async function resolveChemistryPickListId(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    pickListId?: string | null;
    listName?: string | null;
  },
): Promise<string> {
  if (input.pickListId) return input.pickListId;
  const existing = (await listPickLists(client, { orgId: input.orgId, eventKey: input.eventKey }))[0];
  if (existing) return existing.id;
  return ensurePickList(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    name: input.listName ?? null,
    source: "chemistry",
  });
}

/**
 * Promote chemistry candidates onto the canonical pick list for an event.
 *
 * Idempotent: upsertEntry conflicts on (pick_list_id, team_key), so promoting the same alliance
 * twice updates the bucket instead of duplicating rows or shuffling ranks. A team with no
 * teams_ref row is reported as rejected rather than invented. Partner-fit notes land only when
 * `fit.score` is a real MODEL number.
 */
export async function promoteChemistryShortlist(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    teamKeys: Array<string | number | null | undefined>;
    bucket?: unknown;
    notes?: string | null;
    pickListId?: string | null;
    listName?: string | null;
    fit?: PartnerFitContext | null;
  },
): Promise<PromoteResult> {
  const bucket = bucketOrDefault(input.bucket);
  const { teamKeys, rejected } = normalizeShortlist(input.teamKeys);
  if (!teamKeys.length) {
    throw new Error("Pick at least one valid team number to save to the pick list.");
  }

  const pickListId = await resolveChemistryPickListId(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    pickListId: input.pickListId,
    listName: input.listName,
  });

  const attachFit = shouldAttachPartnerFit(teamKeys, input.fit?.allianceTeamKeys ?? teamKeys);
  const fit = attachFit ? input.fit : null;
  const notes = partnerFitNotes({ fit, notes: input.notes });
  const justification = partnerFitJustification(fit);

  const promoted: string[] = [];
  const unknownTeams: string[] = [];
  for (const teamKey of teamKeys) {
    // Per-team savepoint. A team the TBA reference has never seen raises a foreign
    // key violation, which aborts the whole transaction — so `continue` moved on
    // to a dead transaction, the next team failed with "current transaction is
    // aborted", that message does not match /team reference/, and the rethrow
    // discarded every team promoted before it. Rolling back to the savepoint
    // leaves the earlier entries intact and the loop able to continue.
    let outcome: "promoted" | "unknown";
    try {
      outcome = await withSavepointOrThrow(client, async () => {
        const entryId = await upsertEntry(client, {
          orgId: input.orgId,
          userId: input.userId,
          pickListId,
          teamKey,
          bucket,
          notes,
        });
        if (justification) {
          await setJustification(client, {
            orgId: input.orgId,
            userId: input.userId,
            pickListId,
            entryId,
            rationale: justification.rationale,
            sources: justification.sources,
            contradictionFlagged: false,
            contradictionReason: null,
          });
        }
        return "promoted" as const;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/team reference/i.test(message)) throw error;
      outcome = "unknown";
    }
    if (outcome === "promoted") promoted.push(teamKey);
    else unknownTeams.push(teamKey);
  }

  const allRejected = [...rejected, ...unknownTeams];
  return {
    pickListId,
    promoted,
    rejected: allRejected,
    bucket,
    message: promoted.length
      ? `Saved ${promoted.map((key) => key.replace(/^frc/, "")).join(", ")} to the pick list.${
          allRejected.length
            ? ` Skipped ${allRejected.join(", ")} — sync the event teams first.`
            : ""
        }`
      : `Nothing was saved — ${allRejected.join(", ")} are not in the synced event teams yet.`,
  };
}
