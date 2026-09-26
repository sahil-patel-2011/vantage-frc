import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  applyAutoAssignments,
  assignCoverageSlot,
  canWriteAssignments,
  computeScoutingCoverageView,
  planAutoAssignments,
  swapCoverageSlot,
} from "../../../../lib/scouting/coverage";
import { expandAssignmentRange } from "../../../../lib/scouting/assignment-range";
import { loadWatchlistTeamKeys } from "../../../../lib/watchlist";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../../lib/scout-org-access";
import { eventKeyFromMatchKey } from "../../../../lib/webhooks/tba-messages";
import {
  assignmentConflict,
  describeAssignmentConflict,
  withAssignment,
  type AssignmentConflictContext,
} from "../../../../lib/scouting/assignment-conflicts";
import { loadAssignmentConflictContext } from "../../../../lib/scouting/assignment-conflicts-load";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/** A refused assignment: the coordinator gets the reason, nothing is written. */
function conflictError(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

async function memberName(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ name: string | null }>(
    `SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''),
                  NULLIF(split_part(u.email, '@', 1), '')) AS name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
      LIMIT 1`,
    [orgId, userId],
  );
  return row.rows[0]?.name ?? null;
}

const WRITE_ACTIONS = new Set(["assign", "swap", "auto-assign", "assign-range"]);

function noStore(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return session;
}

function windowSizeOf(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function qualsOnlyOf(value: string | null | unknown): boolean {
  if (value === "0" || value === "false" || value === false) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const priorityTeamKeys = requestedOrg ? await loadWatchlistTeamKeys(client, requestedOrg) : [];
      return computeScoutingCoverageView(client, {
        userId: session.user.id,
        requestedOrg,
        requestedEvent: url.searchParams.get("eventKey"),
        matchKey: url.searchParams.get("matchKey") ?? undefined,
        windowSize: windowSizeOf(url.searchParams.get("window")),
        qualsOnly: qualsOnlyOf(url.searchParams.get("qualsOnly")),
        priorityTeamKeys,
      });
    });
    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json({ error: publicErrorMessage(error, "Coverage request failed") }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!WRITE_ACTIONS.has(action)) {
      return Response.json({ error: `Unknown action: ${action || "(missing)"}` }, { status: 400 });
    }

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [orgId, session.user.id],
      );
      const role = membership.rows[0]?.role ?? null;
      if (!canWriteAssignments(role)) {
        throw Object.assign(new Error("Organization access denied"), { status: 403 });
      }

      const priorityTeamKeys = await loadWatchlistTeamKeys(client, orgId);
      const matchKey = typeof body.matchKey === "string" ? body.matchKey : "";
      const teamKey = typeof body.teamKey === "string" ? body.teamKey : "";
      const eventKey =
        (typeof body.eventKey === "string" && body.eventKey.trim()) ||
        eventKeyFromMatchKey(matchKey) ||
        "";

      // Drive team and one-robot-per-match are checked for every write below.
      let conflicts: AssignmentConflictContext | null = eventKey
        ? await loadAssignmentConflictContext(client, { orgId, eventKey })
        : null;
      const refused: string[] = [];

      if (action === "assign") {
        const assignee = typeof body.userId === "string" ? body.userId : session.user.id;
        const conflict = conflicts ? assignmentConflict(conflicts, { userId: assignee, matchKey, teamKey }) : null;
        if (conflict) {
          throw conflictError(describeAssignmentConflict(conflict, await memberName(client, orgId, assignee)));
        }
        await assignCoverageSlot(client, {
          orgId,
          eventKey,
          matchKey,
          teamKey,
          userId: assignee,
        });
      } else if (action === "assign-range") {
        const preview = await computeScoutingCoverageView(client, {
          userId: session.user.id,
          requestedOrg: orgId,
          priorityTeamKeys,
          qualsOnly: qualsOnlyOf(body.qualsOnly),
        });
        const boardKeys = preview.status === "live" ? preview.slots.map((slot) => slot.matchKey) : [];
        const range = expandAssignmentRange({
          firstMatchKey: typeof body.firstMatchKey === "string" ? body.firstMatchKey : "",
          lastMatchKey: typeof body.lastMatchKey === "string" ? body.lastMatchKey : "",
          teamKey,
          matchKeys: boardKeys,
          qualsOnly: qualsOnlyOf(body.qualsOnly),
          schedule: preview.status === "live" ? preview.slots : [],
        });
        if (!range.ok) {
          throw Object.assign(new Error(range.error), { status: 400 });
        }
        const assignee = typeof body.userId === "string" ? body.userId : session.user.id;
        for (const slot of range.slots) {
          const conflict = conflicts
            ? assignmentConflict(conflicts, { userId: assignee, matchKey: slot.matchKey, teamKey: slot.teamKey })
            : null;
          if (conflict) {
            // A range is many matches; skip the ones that clash and say which.
            refused.push(describeAssignmentConflict(conflict, null));
            continue;
          }
          if (conflicts) conflicts = withAssignment(conflicts, { userId: assignee, matchKey: slot.matchKey, teamKey: slot.teamKey });
          await assignCoverageSlot(client, {
            orgId,
            eventKey: eventKey || eventKeyFromMatchKey(slot.matchKey) || "",
            matchKey: slot.matchKey,
            teamKey: slot.teamKey,
            userId: assignee,
          });
        }
      } else if (action === "swap") {
        const toUserId = String(body.toUserId ?? "");
        const conflict = conflicts ? assignmentConflict(conflicts, { userId: toUserId, matchKey, teamKey }) : null;
        if (conflict) {
          throw conflictError(describeAssignmentConflict(conflict, await memberName(client, orgId, toUserId)));
        }
        await swapCoverageSlot(client, {
          orgId,
          matchKey,
          teamKey,
          fromUserId: String(body.fromUserId ?? ""),
          toUserId,
        });
      } else {
        const preview = await computeScoutingCoverageView(client, {
          userId: session.user.id,
          requestedOrg: orgId,
          priorityTeamKeys,
          qualsOnly: qualsOnlyOf(body.qualsOnly),
          matchKey: typeof body.focusMatchKey === "string" ? body.focusMatchKey : undefined,
        });
        if (preview.status === "live") {
          const context =
            conflicts && preview.eventKey === eventKey
              ? conflicts
              : await loadAssignmentConflictContext(client, { orgId, eventKey: preview.eventKey });
          await applyAutoAssignments(client, {
            orgId,
            eventKey: preview.eventKey,
            plan: planAutoAssignments({
              slots: preview.slots,
              playedMatchKeys: preview.playedMatchKeys,
              scouts: preview.scouts,
              priorityTeamKeys,
              isBlocked: (userId, slot) => assignmentConflict(context, { userId, ...slot }) != null,
            }),
          });
        }
      }

      const next = await computeScoutingCoverageView(client, {
        userId: session.user.id,
        requestedOrg: orgId,
        priorityTeamKeys,
        qualsOnly: qualsOnlyOf(body.qualsOnly),
        matchKey: typeof body.focusMatchKey === "string" ? body.focusMatchKey : undefined,
      });
      // Extra field; clients that do not read it render the view exactly as before.
      return refused.length ? { ...next, refused } : next;
    });

    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const status =
      error instanceof Error && "status" in error && (error.status === 403 || error.status === 409)
        ? (error.status as number)
        : 400;
    const message = publicErrorMessage(error, "Coverage request failed");
    if (status === 403) return scoutForbiddenResponse();
    return Response.json({ error: message }, { status });
  }
}
