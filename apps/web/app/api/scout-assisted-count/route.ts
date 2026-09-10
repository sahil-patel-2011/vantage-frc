import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  COUNT_METRIC_KEYS,
  closeSession,
  computeScoutAssistedCountView,
  recordTap,
  startSession,
  type CountMetricKey,
  type ScoutAssistedCountView,
} from "../../../lib/scout-assisted-count/compute-scout-assisted-count";

export type { ScoutAssistedCountView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function intOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutAssistedCountView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load scout-assisted counting. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ScoutAssistedCountView,
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
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "start-session": {
          const label = trimmedOrNull(body.label, 200);
          if (!label) throw new Error("label is required");
          const metricKey = oneOf<CountMetricKey>(COUNT_METRIC_KEYS, body.metricKey) ?? "other";
          await startSession(client, {
            orgId,
            userId,
            metricKey,
            matchKey: trimmedOrNull(body.matchKey, 64),
            teamKey: trimmedOrNull(body.teamKey, 32),
            label,
          });
          break;
        }
        case "tap": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await recordTap(client, {
            orgId,
            userId,
            sessionId,
            delta: intOrDefault(body.delta, 1),
          });
          break;
        }
        case "close-session": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await closeSession(client, { orgId, sessionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutAssistedCountView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout-assisted count request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
