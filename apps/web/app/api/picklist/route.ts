// The ONE pick-list endpoint. Every pick-list surface can read and mutate the same rows here;
// the older per-surface routes (/api/picklist-collab, /api/alliance-selection-desk,
// /api/picklist-justifier) now sit on the same store and are kept for their surface-shaped views.

import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failDbWrite } from "../../../lib/db-error";
import {
  DRAFT_PICK_SLOTS,
  boardState,
  deleteEntry,
  ensurePickList,
  isPickBucket,
  listPickList,
  listPickLists,
  recordVote,
  removeVote,
  reorderEntry,
  setBoardScratch,
  setBoardSlot,
  setEntryNotes,
  setListStatus,
  upsertEntry,
  type BoardStateView,
  type DraftPickSlot,
  type PickBucket,
  type PickListRecord,
  type PickListSnapshot,
  type PickListStatus,
  type ReorderConflict,
} from "../../../lib/picklist";

export type PickListApiView =
  | {
      status: "setup_required";
      message: string;
      steps: Array<{ id: string; label: string; detail: string; href: string }>;
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string | null;
      lists: PickListRecord[];
      snapshot: PickListSnapshot | null;
      board: BoardStateView | null;
      conflict: ReorderConflict | null;
      computedAt: string;
    };

const LIST_STATUSES: PickListStatus[] = ["open", "locked", "archived"];

function setupRequired(
  message: string,
  orgId: string | null,
  eventKey: string | null = null,
): PickListApiView {
  return {
    status: "setup_required",
    message,
    steps: [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before ranking alliances.",
        href: "/workspace",
      },
      {
        id: "event",
        label: "Set an active event",
        detail: "A pick list belongs to one TBA event.",
        href: "/competition",
      },
    ],
    orgId,
    eventKey,
  };
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bucketOrUndefined(value: unknown): PickBucket | undefined {
  return isPickBucket(value) ? value : undefined;
}

function pickSlotOrNull(value: unknown): DraftPickSlot | null {
  return typeof value === "string" && (DRAFT_PICK_SLOTS as string[]).includes(value)
    ? (value as DraftPickSlot)
    : null;
}

async function resolveContext(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; eventKey: string | null } | null> {
  const result = await client.query<{ orgId: string; eventKey: string | null }>(
    `SELECT m.org_id AS "orgId", c.active_event_key AS "eventKey"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const pickListId = url.searchParams.get("pickListId");
  const eventKeyParam = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const context = await resolveContext(client, session.user.id, requestedOrg);
      if (!context) return setupRequired("Select a team to open the pick list.", null);

      const eventKey = eventKeyParam ?? context.eventKey;
      const lists = await listPickLists(client, { orgId: context.orgId });
      const snapshot = await listPickList(client, {
        orgId: context.orgId,
        pickListId,
        eventKey: pickListId ? null : eventKey,
      });
      const board = snapshot
        ? await boardState(client, { orgId: context.orgId, pickListId: snapshot.list.id })
        : null;

      return {
        status: "live" as const,
        orgId: context.orgId,
        eventKey,
        lists,
        snapshot,
        board,
        conflict: null,
        computedAt: new Date().toISOString(),
      };
    });
    return Response.json(view);
  } catch {
    return Response.json(
      setupRequired("Could not load the pick list. Confirm workspace and database access.", null),
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      const context = await resolveContext(client, userId, orgId);
      const eventKey = trimmedOrNull(body.eventKey, 64) ?? context?.eventKey ?? null;
      let pickListId = trimmedOrNull(body.pickListId, 64);
      let conflict: ReorderConflict | null = null;

      if (!pickListId && action !== "create-list") {
        const existing = await listPickList(client, { orgId, eventKey });
        pickListId = existing?.list.id ?? null;
      }

      switch (action) {
        case "create-list": {
          if (!eventKey) throw new Error("eventKey is required");
          pickListId = await ensurePickList(client, {
            orgId,
            userId,
            eventKey,
            name: trimmedOrNull(body.name, 200) ?? "Pick list",
            seasonYear: intOrNull(body.seasonYear),
            source: "manual",
          });
          break;
        }
        case "set-status": {
          if (!pickListId) throw new Error("pickListId is required");
          const status = LIST_STATUSES.find((value) => value === body.status);
          if (!status) throw new Error("status must be open, locked or archived");
          await setListStatus(client, { orgId, userId, pickListId, status });
          break;
        }
        case "upsert-entry": {
          if (!pickListId) {
            if (!eventKey) throw new Error("eventKey is required");
            pickListId = await ensurePickList(client, { orgId, userId, eventKey });
          }
          const team =
            trimmedOrNull(body.teamKey, 16) ??
            (body.teamNumber != null ? String(body.teamNumber) : null);
          if (!team) throw new Error("teamKey or teamNumber is required");
          await upsertEntry(client, {
            orgId,
            userId,
            pickListId,
            teamKey: team,
            bucket: bucketOrUndefined(body.bucket),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "set-notes": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!pickListId || !entryId) throw new Error("pickListId and entryId are required");
          await setEntryNotes(client, {
            orgId,
            userId,
            pickListId,
            entryId,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "reorder": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!pickListId || !entryId) throw new Error("pickListId and entryId are required");
          const toIndex = intOrNull(body.toIndex);
          if (toIndex == null) throw new Error("toIndex is required");
          const result = await reorderEntry(client, {
            orgId,
            userId,
            pickListId,
            entryId,
            toIndex,
            bucket: bucketOrUndefined(body.bucket),
            expectedRevision: intOrNull(body.expectedRevision),
          });
          conflict = result.conflict;
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!pickListId || !entryId) throw new Error("pickListId and entryId are required");
          await deleteEntry(client, { orgId, userId, pickListId, entryId });
          break;
        }
        case "vote": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!pickListId || !entryId) throw new Error("pickListId and entryId are required");
          await recordVote(client, {
            orgId,
            userId,
            pickListId,
            entryId,
            weight: Number(body.weight) || 1,
            rankSuggestion: intOrNull(body.rankSuggestion),
            comment: trimmedOrNull(body.comment, 1000),
          });
          break;
        }
        case "remove-vote": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!pickListId || !entryId) throw new Error("pickListId and entryId are required");
          await removeVote(client, { orgId, userId, pickListId, entryId });
          break;
        }
        case "set-board-slot": {
          if (!pickListId) throw new Error("pickListId is required");
          const allianceSeed = intOrNull(body.allianceSeed);
          const pickSlot = pickSlotOrNull(body.pickSlot);
          if (allianceSeed == null || !pickSlot) {
            throw new Error("allianceSeed (1-8) and pickSlot are required");
          }
          const team =
            trimmedOrNull(body.teamKey, 16) ??
            (body.teamNumber != null ? String(body.teamNumber) : null);
          await setBoardSlot(client, {
            orgId,
            userId,
            pickListId,
            allianceSeed,
            pickSlot,
            teamKey: team,
            rationale: trimmedOrNull(body.rationale, 2000),
          });
          break;
        }
        case "set-board-scratch": {
          if (!pickListId) throw new Error("pickListId is required");
          const scratch =
            body.boardState && typeof body.boardState === "object"
              ? (body.boardState as Record<string, unknown>)
              : {};
          await setBoardScratch(client, { orgId, userId, pickListId, boardState: scratch });
          break;
        }
        default:
          throw new Error(`Unknown action: ${action || "(empty)"}`);
      }

      const lists = await listPickLists(client, { orgId });
      const snapshot = pickListId ? await listPickList(client, { orgId, pickListId }) : null;
      const board = snapshot
        ? await boardState(client, { orgId, pickListId: snapshot.list.id })
        : null;

      return {
        status: "live" as const,
        orgId,
        eventKey,
        lists,
        snapshot,
        board,
        conflict,
        computedAt: new Date().toISOString(),
      } satisfies PickListApiView;
    });

    return Response.json(view);
  } catch (error) {
    // A pick list is keyed to an event, and `pick_lists.event_key` references
    // events_ref. Before an event is ingested from TBA that insert raises a
    // 23503 whose raw text ("violates foreign key constraint
    // pick_lists_event_key_fkey") used to be handed straight to the pit.
    return failDbWrite(error, "Pick-list request failed");
  }
}
