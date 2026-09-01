import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  applyAutoAssignments,
  assignCoverageSlot,
  canWriteAssignments,
  computeScoutingCoverageView,
  planAutoAssignments,
  swapCoverageSlot,
} from "../../../../lib/scouting/coverage";
import { loadWatchlistTeamKeys } from "../../../../lib/watchlist";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../../lib/scout-org-access";
import { eventKeyFromMatchKey } from "../../../../lib/webhooks/tba-messages";

const WRITE_ACTIONS = new Set(["assign", "swap", "auto-assign"]);

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
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

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
    return Response.json({ error: error instanceof Error ? error.message : "Coverage request failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

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

      if (action === "assign") {
        await assignCoverageSlot(client, {
          orgId,
          eventKey,
          matchKey,
          teamKey,
          userId: typeof body.userId === "string" ? body.userId : session.user.id,
        });
      } else if (action === "swap") {
        await swapCoverageSlot(client, {
          orgId,
          matchKey,
          teamKey,
          fromUserId: String(body.fromUserId ?? ""),
          toUserId: String(body.toUserId ?? ""),
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
          await applyAutoAssignments(client, {
            orgId,
            eventKey: preview.eventKey,
            plan: planAutoAssignments({
              slots: preview.slots,
              scouts: preview.scouts,
              priorityTeamKeys,
            }),
          });
        }
      }

      return computeScoutingCoverageView(client, {
        userId: session.user.id,
        requestedOrg: orgId,
        priorityTeamKeys,
        qualsOnly: qualsOnlyOf(body.qualsOnly),
        matchKey: typeof body.focusMatchKey === "string" ? body.focusMatchKey : undefined,
      });
    });

    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const status = error instanceof Error && "status" in error && error.status === 403 ? 403 : 400;
    const message = error instanceof Error ? error.message : "Coverage request failed";
    if (status === 403) return scoutForbiddenResponse();
    return Response.json({ error: message }, { status });
  }
}
