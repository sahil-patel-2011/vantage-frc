import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeScoutTrainingView,
  deleteAttempt,
  submitAttempt,
  type ScoutTrainingView,
} from "../../../lib/scout-training-mode/compute-scout-training-mode";
import type { TrainingWinner } from "../../../lib/scout-training-mode/types";

export type { ScoutTrainingView };

const TRAINING_WINNERS: TrainingWinner[] = ["red", "blue", "tie"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutTrainingView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load scout training mode. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ScoutTrainingView,
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
        case "submit-attempt": {
          const matchKey = trimmedOrNull(body.matchKey, 64);
          if (!matchKey) throw new Error("matchKey is required");
          const predictedWinner = oneOf<TrainingWinner>(TRAINING_WINNERS, body.predictedWinner);
          if (!predictedWinner) throw new Error("predictedWinner is required");
          await submitAttempt(client, {
            orgId,
            userId,
            matchKey,
            predictedWinner,
            predictedRedScore: nonNegativeInt(body.predictedRedScore),
            predictedBlueScore: nonNegativeInt(body.predictedBlueScore),
            durationSeconds: nonNegativeInt(body.durationSeconds),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-attempt": {
          const attemptId = trimmedOrNull(body.attemptId, 64);
          if (!attemptId) throw new Error("attemptId is required");
          await deleteAttempt(client, { orgId, attemptId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutTrainingView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout training mode request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
