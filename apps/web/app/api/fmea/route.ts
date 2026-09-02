import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  FMEA_CONTEXTS,
  FMEA_STATUSES,
  computeFmeaView,
  createFailure,
  currentSeasonYear,
  deleteFailure,
  updateFailure,
  type FmeaView,
} from "../../../lib/fmea/compute-fmea";
import type { FmeaContext, FmeaStatus } from "../../../lib/fmea/types";

export type { FmeaView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function scaleOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f-]{36}$/i.test(trimmed) ? trimmed : null;
}

/** Parts consumed by a failure: a non-negative quantity, capped so a typo cannot empty a bin. */
function consumedQtyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new Error("partsConsumedQty must be between 0 and 10000");
  return Math.round(n * 100) / 100;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeFmeaView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the failure log. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies FmeaView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-failure": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const subsystemId = uuidOrNull(body.subsystemId);
          const subsystemName =
            trimmedOrNull(body.subsystemName, 120) ??
            (subsystemId ? "" : null);
          if (!subsystemId && !subsystemName) throw new Error("subsystem is required");
          await createFailure(client, {
            orgId,
            userId,
            seasonYear,
            title,
            failureMode: trimmedOrNull(body.failureMode, 500) ?? "",
            context: oneOf<FmeaContext>(FMEA_CONTEXTS, body.context) ?? "pit",
            subsystemId,
            subsystemName: subsystemName ?? "",
            occurrence: scaleOrNull(body.occurrence) ?? 3,
            severity: scaleOrNull(body.severity) ?? 3,
            detection: scaleOrNull(body.detection) ?? 3,
            rootCause: trimmedOrNull(body.rootCause),
            fiveWhys: trimmedOrNull(body.fiveWhys),
            fix: trimmedOrNull(body.fix),
            status: oneOf<FmeaStatus>(FMEA_STATUSES, body.status) ?? "open",
            inspectionItemId: uuidOrNull(body.inspectionItemId),
            eventKey: trimmedOrNull(body.eventKey, 64),
            matchKey: trimmedOrNull(body.matchKey, 64),
            robotLabel: trimmedOrNull(body.robotLabel, 64) ?? "competition",
            occurredAt: trimmedOrNull(body.occurredAt, 40),
            // ONE PARTS LEDGER: a failure that ate a spare decrements that bin (source 'fmea').
            inventoryItemId: uuidOrNull(body.inventoryItemId),
            partsConsumedQty: consumedQtyOrNull(body.partsConsumedQty),
          });
          break;
        }
        case "update-failure": {
          const failureId = uuidOrNull(body.failureId) ?? trimmedOrNull(body.failureId, 64);
          if (!failureId) throw new Error("failureId is required");
          const context = body.context === undefined ? undefined : oneOf<FmeaContext>(FMEA_CONTEXTS, body.context);
          if (body.context !== undefined && !context) throw new Error("Invalid context");
          const status = body.status === undefined ? undefined : oneOf<FmeaStatus>(FMEA_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateFailure(client, {
            orgId,
            failureId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            failureMode: body.failureMode === undefined ? undefined : (trimmedOrNull(body.failureMode, 500) ?? ""),
            context: context ?? undefined,
            subsystemId: body.subsystemId === undefined ? undefined : uuidOrNull(body.subsystemId),
            subsystemName:
              body.subsystemName === undefined ? undefined : (trimmedOrNull(body.subsystemName, 120) ?? undefined),
            occurrence: body.occurrence === undefined ? undefined : (scaleOrNull(body.occurrence) ?? undefined),
            severity: body.severity === undefined ? undefined : (scaleOrNull(body.severity) ?? undefined),
            detection: body.detection === undefined ? undefined : (scaleOrNull(body.detection) ?? undefined),
            rootCause: body.rootCause === undefined ? undefined : trimmedOrNull(body.rootCause),
            fiveWhys: body.fiveWhys === undefined ? undefined : trimmedOrNull(body.fiveWhys),
            fix: body.fix === undefined ? undefined : trimmedOrNull(body.fix),
            status: status ?? undefined,
            inspectionItemId:
              body.inspectionItemId === undefined ? undefined : uuidOrNull(body.inspectionItemId),
            userId,
            inventoryItemId: body.inventoryItemId === undefined ? undefined : uuidOrNull(body.inventoryItemId),
            partsConsumedQty: body.partsConsumedQty === undefined ? undefined : consumedQtyOrNull(body.partsConsumedQty),
          });
          break;
        }
        case "delete-failure": {
          const failureId = uuidOrNull(body.failureId) ?? trimmedOrNull(body.failureId, 64);
          if (!failureId) throw new Error("failureId is required");
          await deleteFailure(client, { orgId, failureId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeFmeaView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failure log request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
