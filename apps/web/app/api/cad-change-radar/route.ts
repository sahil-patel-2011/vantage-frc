import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  acknowledgeNotification,
  computeCadChangeRadarView,
  generateAiDiffSummary,
  recordSnapshot,
  subscribe,
  unsubscribe,
  type CadChangeRadarView,
} from "../../../lib/cad-change-radar/compute-cad-change-radar";

export type { CadChangeRadarView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function paramsRecord(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number | string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "string" && raw.trim()) out[key] = raw.trim().slice(0, 200);
  }
  return out;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeCadChangeRadarView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Change radar. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies CadChangeRadarView,
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
        case "record-snapshot": {
          const connectionId = trimmedOrNull(body.connectionId, 64);
          const partKey = trimmedOrNull(body.partKey, 200);
          const partName = trimmedOrNull(body.partName, 200);
          const revision = trimmedOrNull(body.revision, 100);
          if (!connectionId) throw new Error("connectionId is required");
          if (!partKey) throw new Error("partKey is required");
          if (!partName) throw new Error("partName is required");
          if (!revision) throw new Error("revision is required");
          await recordSnapshot(client, {
            orgId,
            userId,
            connectionId,
            partKey,
            partName,
            revision,
            params: paramsRecord(body.params),
            massKg: finiteNumberOrNull(body.massKg),
          });
          break;
        }
        case "generate-summary": {
          const diffId = trimmedOrNull(body.diffId, 64);
          if (!diffId) throw new Error("diffId is required");
          await generateAiDiffSummary(client, { orgId, userId, diffId });
          break;
        }
        case "subscribe": {
          const partKey = trimmedOrNull(body.partKey, 200);
          if (!partKey) throw new Error("partKey is required");
          await subscribe(client, { orgId, userId, partKey, subsystem: trimmedOrNull(body.subsystem, 100) });
          break;
        }
        case "unsubscribe": {
          const subscriptionId = trimmedOrNull(body.subscriptionId, 64);
          if (!subscriptionId) throw new Error("subscriptionId is required");
          await unsubscribe(client, { orgId, userId, subscriptionId });
          break;
        }
        case "acknowledge-notification": {
          const notificationId = trimmedOrNull(body.notificationId, 64);
          if (!notificationId) throw new Error("notificationId is required");
          await acknowledgeNotification(client, { orgId, userId, notificationId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCadChangeRadarView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Change radar request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
