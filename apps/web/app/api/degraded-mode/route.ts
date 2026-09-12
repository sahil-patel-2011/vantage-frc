import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { DEGRADED_MODE_REASONS, DEGRADED_MODE_SOURCES } from "../../../lib/degraded-mode";
import {
  acknowledgeDegradedMode,
  clearAcknowledgment,
  computeDegradedModeView,
  type DegradedModeView,
} from "../../../lib/degraded-mode/compute-degraded-mode";
import type { DegradedModeReason, DegradedModeSource } from "../../../lib/degraded-mode/types";

export type { DegradedModeView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeDegradedModeView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load data-source health. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies DegradedModeView,
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
        case "acknowledge": {
          const source = oneOf<DegradedModeSource>(DEGRADED_MODE_SOURCES, body.source) ?? "tba";
          const mode = oneOf<DegradedModeReason>(DEGRADED_MODE_REASONS, body.mode);
          if (!mode) throw new Error("mode is required");
          await acknowledgeDegradedMode(client, {
            orgId,
            userId,
            source,
            mode,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "clear-acknowledgment": {
          const acknowledgmentId = trimmedOrNull(body.acknowledgmentId, 64);
          if (!acknowledgmentId) throw new Error("acknowledgmentId is required");
          await clearAcknowledgment(client, { orgId, acknowledgmentId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDegradedModeView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Degraded-mode request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
