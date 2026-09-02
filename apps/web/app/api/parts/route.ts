// /api/parts — the unified parts ledger (0505): GET one view of on-hand / reserved /
// available / unallocated; POST consume | receive | reserve | release | consume-reservation.
// Every write goes through lib/parts (append-only inventory_transactions), never a bare UPDATE.

import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computePartsView,
  consumeReservation,
  isReservationSourceKind,
  movePart,
  releaseReservation,
  reservePart,
  type PartsView,
} from "../../../lib/parts/compute-parts";
import { consumeForSource } from "../../../lib/parts/store";

export type { PartsView };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : null;
}

function trimmedOrNull(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function quantityOf(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new HttpError(400, "quantity must be between 0 and 1,000,000");
  return Math.round(n * 100) / 100;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`, [
    orgId,
    userId,
  ]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Parts request failed" }, { status });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const includeArchived = url.searchParams.get("archived") === "1";
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePartsView(client, { userId: session.user.id, requestedOrg, includeArchived }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load parts. Select a workspace and confirm database migrations (0505) are applied.",
        orgId: null,
      } satisfies PartsView,
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
  const orgId = uuidOrNull(body.orgId);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const userId = session.user.id;

  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      await requireMembership(client, orgId, userId);
      switch (action) {
        case "consume": {
          const itemId = uuidOrNull(body.itemId);
          if (!itemId) throw new HttpError(400, "itemId is required");
          const quantity = quantityOf(body.quantity);
          const sourceKind = trimmedOrNull(body.sourceKind, 40);
          const sourceId = uuidOrNull(body.sourceId);
          // A sourced consumption is idempotent per (item, source); an unsourced one is a plain movement.
          if (sourceKind && sourceId) {
            const [moved] = await consumeForSource(client, {
              orgId,
              userId,
              sourceKind,
              sourceId,
              note: trimmedOrNull(body.note) ?? "",
              items: [{ itemId, quantity }],
            });
            return { consumed: moved?.consumed ?? 0, quantity: moved?.remaining ?? null };
          }
          const remaining = await movePart(client, {
            orgId,
            userId,
            itemId,
            quantity,
            direction: "consume",
            note: trimmedOrNull(body.note) ?? undefined,
          });
          return { consumed: quantity, quantity: remaining };
        }
        case "receive": {
          const itemId = uuidOrNull(body.itemId);
          if (!itemId) throw new HttpError(400, "itemId is required");
          const quantity = quantityOf(body.quantity);
          const remaining = await movePart(client, {
            orgId,
            userId,
            itemId,
            quantity,
            direction: "receive",
            note: trimmedOrNull(body.note) ?? undefined,
          });
          return { received: quantity, quantity: remaining };
        }
        case "reserve": {
          const itemId = uuidOrNull(body.itemId);
          if (!itemId) throw new HttpError(400, "itemId is required");
          const sourceKind = isReservationSourceKind(body.sourceKind) ? body.sourceKind : "manual";
          return reservePart(client, {
            orgId,
            userId,
            itemId,
            quantity: quantityOf(body.quantity),
            sourceKind,
            sourceId: uuidOrNull(body.sourceId),
            note: trimmedOrNull(body.note) ?? "",
          });
        }
        case "release": {
          const reservationId = uuidOrNull(body.reservationId);
          if (!reservationId) throw new HttpError(400, "reservationId is required");
          await releaseReservation(client, { orgId, reservationId });
          return { ok: true };
        }
        case "consume-reservation": {
          const reservationId = uuidOrNull(body.reservationId);
          if (!reservationId) throw new HttpError(400, "reservationId is required");
          return consumeReservation(client, { orgId, userId, reservationId });
        }
        default:
          throw new HttpError(400, "Unsupported parts action");
      }
    });
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
