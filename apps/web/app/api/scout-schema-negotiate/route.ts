import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  computeScoutSchemaNegotiateView,
  reconcileSubmission,
  registerSchemaVersion,
  rejectSubmission,
  submitEntry,
  type ScoutSchemaNegotiateView,
} from "../../../lib/scout-schema-negotiate/compute-scout-schema-negotiate";

export type { ScoutSchemaNegotiateView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function stringArray(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 200))
    .slice(0, max);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutSchemaNegotiateView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Schema sync. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ScoutSchemaNegotiateView,
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
        case "register-version": {
          const versionTag = trimmedOrNull(body.versionTag, 100);
          if (!versionTag) throw new Error("versionTag is required");
          await registerSchemaVersion(client, {
            orgId,
            userId,
            versionTag,
            fieldKeys: stringArray(body.fieldKeys),
            makeActive: body.makeActive === true,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "submit-entry": {
          const deviceId = trimmedOrNull(body.deviceId, 200);
          const schemaVersion = trimmedOrNull(body.schemaVersion, 100);
          if (!deviceId) throw new Error("deviceId is required");
          if (!schemaVersion) throw new Error("schemaVersion is required");
          await submitEntry(client, {
            orgId,
            userId,
            deviceId,
            schemaVersion,
            matchNumber: intOrNull(body.matchNumber),
            teamNumber: intOrNull(body.teamNumber),
            rawPayload: plainObject(body.rawPayload),
          });
          break;
        }
        case "reconcile-submission": {
          const submissionId = trimmedOrNull(body.submissionId, 64);
          if (!submissionId) throw new Error("submissionId is required");
          await reconcileSubmission(client, {
            orgId,
            submissionId,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "reject-submission": {
          const submissionId = trimmedOrNull(body.submissionId, 64);
          if (!submissionId) throw new Error("submissionId is required");
          await rejectSubmission(client, {
            orgId,
            submissionId,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutSchemaNegotiateView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schema negotiation request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
