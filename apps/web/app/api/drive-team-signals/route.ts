import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SIGNAL_KINDS, SIGNAL_PRIORITIES, SIGNAL_ROLES } from "../../../lib/drive-team-signals";
import {
  addSignal,
  computeDriveTeamSignalsView,
  createSignalSheet,
  deleteSignalSheet,
  removeSignal,
  type DriveTeamSignalsView,
} from "../../../lib/drive-team-signals/compute-drive-team-signals";
import type { SignalKind, SignalPriority, SignalRole } from "../../../lib/drive-team-signals/types";

export type { DriveTeamSignalsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeDriveTeamSignalsView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the drive-team signal board. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies DriveTeamSignalsView,
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
        case "create-sheet": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createSignalSheet(client, {
            orgId,
            userId,
            title,
            gameYear: intOrNull(body.gameYear),
            eventKey: trimmedOrNull(body.eventKey, 100),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "add-signal": {
          const sheetId = trimmedOrNull(body.sheetId, 64);
          const code = trimmedOrNull(body.code, 80);
          const meaning = trimmedOrNull(body.meaning, 400);
          if (!sheetId) throw new Error("sheetId is required");
          if (!code) throw new Error("code is required");
          if (!meaning) throw new Error("meaning is required");
          const kind = oneOf<SignalKind>(SIGNAL_KINDS, body.kind) ?? "other";
          const priority = oneOf<SignalPriority>(SIGNAL_PRIORITIES, body.priority) ?? "important";
          const calledBy = oneOf<SignalRole>(SIGNAL_ROLES, body.calledBy) ?? "driver";
          await addSignal(client, { orgId, sheetId, kind, code, meaning, calledBy, priority });
          break;
        }
        case "remove-signal": {
          const sheetId = trimmedOrNull(body.sheetId, 64);
          const signalId = trimmedOrNull(body.signalId, 64);
          if (!sheetId) throw new Error("sheetId is required");
          if (!signalId) throw new Error("signalId is required");
          await removeSignal(client, { orgId, sheetId, signalId });
          break;
        }
        case "delete-sheet": {
          const sheetId = trimmedOrNull(body.sheetId, 64);
          if (!sheetId) throw new Error("sheetId is required");
          await deleteSignalSheet(client, { orgId, sheetId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDriveTeamSignalsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive-team signal board request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
