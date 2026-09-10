import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeSchemaAbView,
  createCandidate,
  deleteCandidate,
  deleteSample,
  logSample,
  type SchemaAbView,
} from "../../../lib/scouting-schema-ab/compute-scouting-schema-ab";

export type { SchemaAbView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function optionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function boolOf(value: unknown): boolean {
  return value === true || value === "true";
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const compareA = url.searchParams.get("compareA");
  const compareB = url.searchParams.get("compareB");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSchemaAbView(client, { userId: session.user.id, requestedOrg, compareA, compareB }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Schema A/B. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies SchemaAbView,
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
        case "create-candidate": {
          const label = trimmedOrNull(body.label, 200);
          if (!label) throw new Error("label is required");
          await createCandidate(client, {
            orgId,
            userId,
            label,
            fieldCount: nonNegativeInt(body.fieldCount),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-candidate": {
          const candidateId = trimmedOrNull(body.candidateId, 64);
          if (!candidateId) throw new Error("candidateId is required");
          await deleteCandidate(client, { orgId, candidateId });
          break;
        }
        case "log-sample": {
          const candidateId = trimmedOrNull(body.candidateId, 64);
          if (!candidateId) throw new Error("candidateId is required");
          const fieldsTotal = nonNegativeInt(body.fieldsTotal);
          if (fieldsTotal <= 0) throw new Error("fieldsTotal must be greater than 0");
          await logSample(client, {
            orgId,
            userId,
            candidateId,
            matchNumber: optionalInt(body.matchNumber),
            fieldsTotal,
            fieldsCompleted: nonNegativeInt(body.fieldsCompleted),
            fillSeconds: optionalInt(body.fillSeconds),
            hadError: boolOf(body.hadError),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-sample": {
          const sampleId = trimmedOrNull(body.sampleId, 64);
          if (!sampleId) throw new Error("sampleId is required");
          await deleteSample(client, { orgId, sampleId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSchemaAbView(client, {
        userId,
        requestedOrg: orgId,
        compareA: trimmedOrNull(body.compareA, 64),
        compareB: trimmedOrNull(body.compareB, 64),
      });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schema A/B request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
