import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import type { PoolClient } from "@neondatabase/serverless";
import {
  CAD_DOCUMENT_KINDS,
  CAD_DOCUMENT_STATUSES,
  computeCadVaultView,
  currentSeasonYear,
  type CadDocumentKind,
  type CadDocumentStatus,
  type CadVaultView,
} from "../../../lib/cad-vault/view";

export type { CadVaultView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function kindFrom(value: unknown): CadDocumentKind {
  return CAD_DOCUMENT_KINDS.includes(value as CadDocumentKind) ? (value as CadDocumentKind) : "part";
}

function statusFrom(value: unknown): CadDocumentStatus | null {
  return CAD_DOCUMENT_STATUSES.includes(value as CadDocumentStatus) ? (value as CadDocumentStatus) : null;
}

async function requireMember(client: PoolClient, orgId: string, userId: string) {
  const member = await client.query("SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2", [orgId, userId]);
  if (!member.rowCount) throw new Error("You are not a member of this team.");
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = trimmedOrNull(url.searchParams.get("orgId"), 64);
  const seasonParam = url.searchParams.get("seasonYear");
  const seasonYear = seasonParam ? Number(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeCadVaultView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear: Number.isFinite(seasonYear) ? seasonYear : null,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the CAD vault. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: currentSeasonYear(),
      } satisfies CadVaultView,
      { status: 200 },
    );
  }
}

/** Create a document shell (metadata only — versions are uploaded separately). */
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
  const title = trimmedOrNull(body.title, 160);
  if (!orgId || !title) return Response.json({ error: "orgId and title are required" }, { status: 400 });
  const seasonRaw = Number(body.seasonYear);
  const seasonYear = Number.isFinite(seasonRaw) && seasonRaw > 2000 ? Math.round(seasonRaw) : currentSeasonYear();
  const subsystemId = trimmedOrNull(body.subsystemId, 64);
  const description = trimmedOrNull(body.description, 2000);
  const externalUrl = trimmedOrNull(body.externalUrl, 500);
  if (externalUrl && !externalUrl.startsWith("https://")) {
    return Response.json({ error: "External links must start with https://" }, { status: 400 });
  }
  const kind = kindFrom(body.kind);
  const userId = session.user.id;

  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      await requireMember(client, orgId, userId);
      if (subsystemId) {
        const subsystem = await client.query("SELECT 1 FROM robot_subsystems WHERE id = $1::uuid AND org_id = $2::uuid", [subsystemId, orgId]);
        if (!subsystem.rowCount) throw new Error("That subsystem does not exist in this team.");
      }
      const duplicate = await client.query(
        "SELECT 1 FROM cad_documents WHERE org_id = $1::uuid AND season_year = $2::int AND title = $3",
        [orgId, seasonYear, title],
      );
      if (duplicate.rowCount) throw new Error(`A document titled "${title}" already exists for ${seasonYear}. Upload a new version to it instead.`);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO cad_documents(org_id, season_year, title, description, subsystem_id, kind, external_url, created_by)
         VALUES ($1::uuid, $2::int, $3, $4, $5::uuid, $6, $7, $8)
         RETURNING id`,
        [orgId, seasonYear, title, description, subsystemId, kind, externalUrl, userId],
      );
      const view = await computeCadVaultView(client, { userId, requestedOrg: orgId, seasonYear });
      return { documentId: inserted.rows[0]!.id, view };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create the document" }, { status: 400 });
  }
}

/** Retitle, relink to a subsystem, change status, or edit metadata. */
export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const documentId = trimmedOrNull(body.documentId, 64);
  if (!orgId || !documentId) return Response.json({ error: "orgId and documentId are required" }, { status: 400 });
  const userId = session.user.id;

  const title = trimmedOrNull(body.title, 160);
  const description = "description" in body ? trimmedOrNull(body.description, 2000) : undefined;
  const externalUrl = "externalUrl" in body ? trimmedOrNull(body.externalUrl, 500) : undefined;
  if (externalUrl && !externalUrl.startsWith("https://")) {
    return Response.json({ error: "External links must start with https://" }, { status: 400 });
  }
  const status = statusFrom(body.status);
  const hasSubsystemField = "subsystemId" in body;
  const subsystemId = hasSubsystemField ? trimmedOrNull(body.subsystemId, 64) : undefined;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      await requireMember(client, orgId, userId);
      const existing = await client.query<{ id: string; seasonYear: number }>(
        `SELECT id, season_year AS "seasonYear" FROM cad_documents WHERE id = $1::uuid AND org_id = $2::uuid`,
        [documentId, orgId],
      );
      if (!existing.rows[0]) throw new Error("Document not found in this team.");
      if (subsystemId) {
        const subsystem = await client.query("SELECT 1 FROM robot_subsystems WHERE id = $1::uuid AND org_id = $2::uuid", [subsystemId, orgId]);
        if (!subsystem.rowCount) throw new Error("That subsystem does not exist in this team.");
      }
      await client.query(
        `UPDATE cad_documents SET
           title = COALESCE($3, title),
           description = CASE WHEN $4::boolean THEN $5 ELSE description END,
           external_url = CASE WHEN $6::boolean THEN $7 ELSE external_url END,
           status = COALESCE($8, status),
           subsystem_id = CASE WHEN $9::boolean THEN $10::uuid ELSE subsystem_id END,
           updated_by = $11,
           updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [
          documentId,
          orgId,
          title,
          description !== undefined,
          description ?? null,
          externalUrl !== undefined,
          externalUrl ?? null,
          status,
          hasSubsystemField,
          subsystemId ?? null,
          userId,
        ],
      );
      return computeCadVaultView(client, { userId, requestedOrg: orgId, seasonYear: existing.rows[0].seasonYear });
    });
    return Response.json(view);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the document" }, { status: 400 });
  }
}
