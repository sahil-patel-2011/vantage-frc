import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_APPEARANCE_PREFS,
  parseAppearancePrefs,
  type AppearancePrefs,
} from "../../../lib/branding/appearance";
import { emptyBrandingView, type BrandingPayload, type OrgBrandingView } from "../../../lib/branding/branding";
import { normalizeHexColor } from "../../../lib/branding/colors";

export const dynamic = "force-dynamic";

type BrandingRow = {
  accentColor: string | null;
  showLogoInHeader: boolean;
  applyAccentToApp: boolean;
  logoWidth: number | null;
  logoHeight: number | null;
  logoByteSize: number | null;
  logoChecksum: string | null;
  updatedAt: string | null;
};

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

/**
 * Branding follows the same "active workspace" rule as /api/me: the requested org
 * when the caller is a member of it, otherwise their first membership. Returning
 * null (rather than throwing) keeps the shell usable for a signed-in user with no
 * team yet.
 */
async function resolveOrg(client: PoolClient, userId: string, requested: string | null) {
  const memberships = await client.query<{ orgId: string; role: string; orgName: string | null; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", m.role::text AS role, o.name AS "orgName", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              o.team_number NULLS LAST, o.name`,
    [userId],
  );
  if (!memberships.rowCount) return null;
  if (requested) {
    const match = memberships.rows.find((row) => row.orgId === requested);
    if (match) return match;
    // Asked for a workspace they are not in — do not silently answer for another team.
    return null;
  }
  return memberships.rows[0]!;
}

async function loadAppearance(client: PoolClient, userId: string): Promise<AppearancePrefs> {
  const result = await client.query<{ appearancePrefs: unknown }>(
    `SELECT appearance_prefs AS "appearancePrefs" FROM profiles WHERE user_id = $1::uuid`,
    [userId],
  );
  if (!result.rowCount) return { ...DEFAULT_APPEARANCE_PREFS };
  return parseAppearancePrefs(result.rows[0]!.appearancePrefs);
}

async function loadBranding(
  client: PoolClient,
  org: { orgId: string; role: string; orgName: string | null; teamNumber: number | null },
): Promise<OrgBrandingView> {
  const result = await client.query<BrandingRow>(
    `SELECT accent_color AS "accentColor",
            show_logo_in_header AS "showLogoInHeader",
            apply_accent_to_app AS "applyAccentToApp",
            logo_width AS "logoWidth",
            logo_height AS "logoHeight",
            logo_byte_size AS "logoByteSize",
            logo_checksum_sha256 AS "logoChecksum",
            updated_at::text AS "updatedAt"
     FROM org_branding
     WHERE org_id = $1::uuid`,
    [org.orgId],
  );

  const base = emptyBrandingView(org.orgId);
  const row = result.rows[0];
  return {
    ...base,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    canEdit: org.role === "owner" || org.role === "admin",
    accentColor: row?.accentColor ?? null,
    showLogoInHeader: row?.showLogoInHeader ?? true,
    applyAccentToApp: row?.applyAccentToApp ?? true,
    logo: {
      present: Boolean(row?.logoChecksum),
      width: row?.logoWidth ?? null,
      height: row?.logoHeight ?? null,
      byteSize: row?.logoByteSize ?? null,
      version: row?.logoChecksum ? row.logoChecksum.slice(0, 12) : null,
    },
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("orgId");

  try {
    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const appearance = await loadAppearance(client, session.user.id);
      const org = await resolveOrg(client, session.user.id, requested);
      if (!org) return { org: null, appearance } satisfies BrandingPayload;
      const branding = await loadBranding(client, org);
      return { org: branding, appearance } satisfies BrandingPayload;
    });
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // No database / not migrated yet: the shell must still render on stock tokens.
    return Response.json(
      { org: null, appearance: { ...DEFAULT_APPEARANCE_PREFS }, persisted: false } satisfies BrandingPayload & {
        persisted: boolean;
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    orgId?: string;
    accentColor?: string | null;
    showLogoInHeader?: boolean;
    applyAccentToApp?: boolean;
  } | null;

  const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  let accentColor: string | null = null;
  if (body?.accentColor !== null && body?.accentColor !== undefined && body.accentColor !== "") {
    accentColor = normalizeHexColor(body.accentColor);
    if (!accentColor) {
      return Response.json(
        { error: "Team colour must be a hex value like #1f4fd6." },
        { status: 400 },
      );
    }
  }

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const org = await resolveOrg(client, session.user.id, orgId);
      if (!org) throw new Error("Organization access denied");
      if (org.role !== "owner" && org.role !== "admin") {
        throw new Error("A team owner or admin manages branding");
      }

      await client.query(
        `INSERT INTO org_branding(org_id, accent_color, show_logo_in_header, apply_accent_to_app, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid)
         ON CONFLICT (org_id) DO UPDATE SET
           accent_color = excluded.accent_color,
           show_logo_in_header = excluded.show_logo_in_header,
           apply_accent_to_app = excluded.apply_accent_to_app,
           updated_by = excluded.updated_by,
           updated_at = now()`,
        [
          orgId,
          accentColor,
          body?.showLogoInHeader !== false,
          body?.applyAccentToApp !== false,
          session.user.id,
        ],
      );

      return loadBranding(client, org);
    });

    return Response.json({ org: view }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save branding" },
      { status: 400 },
    );
  }
}
