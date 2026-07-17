import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  canWriteOrgDashboard,
  catalogEntry,
  DEFAULT_DASHBOARD_LAYOUT,
  filterLayoutForRole,
  validateDashboardLayout,
  type DashboardWidgetLayout,
} from "../../../lib/dashboard/catalog";
import { loadDashboardSnapshot } from "../../../lib/dashboard/snapshot";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

async function membership(client: import("@neondatabase/serverless").PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new Error("Organization membership required");
  return row.rows[0]!.role;
}

function fail(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : "Dashboard request failed" }, { status });
}

function ensureOnboardingChecklist(layout: DashboardWidgetLayout[]): DashboardWidgetLayout[] {
  if (layout.some((item) => item.type === "onboarding_checklist")) return layout;
  const entry = catalogEntry("onboarding_checklist");
  const offset = entry?.defaultH ?? 4;
  return [
    {
      i: "w-onboarding_checklist",
      type: "onboarding_checklist",
      x: 0,
      y: 0,
      w: entry?.defaultW ?? 12,
      h: offset,
      minW: entry?.minW ?? 6,
      minH: entry?.minH ?? 3,
    },
    ...layout.map((item) => ({ ...item, y: item.y + offset })),
  ];
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const mode = url.searchParams.get("mode") ?? "list";
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await membership(client, orgId, session.user.id);

      if (mode === "snapshot") {
        const snapshot = await loadDashboardSnapshot(client, {
          orgId,
          userId: session.user.id,
          role,
        });
        return { role, ...snapshot };
      }

      const boards = await client.query<{
        id: string;
        name: string;
        scope: "personal" | "org";
        isActive: boolean;
        layout: DashboardWidgetLayout[];
        updatedAt: string;
        ownerUserId: string | null;
      }>(
        `SELECT id, name, scope, is_active AS "isActive", layout, updated_at::text AS "updatedAt",
                owner_user_id AS "ownerUserId"
         FROM dashboards
         WHERE org_id = $1
           AND (
             (scope = 'personal' AND owner_user_id = $2)
             OR scope = 'org'
           )
         ORDER BY scope DESC, is_active DESC, updated_at DESC`,
        [orgId, session.user.id],
      );

      const active =
        boards.rows.find((board) => board.scope === "personal" && board.isActive) ??
        boards.rows.find((board) => board.scope === "org" && board.isActive) ??
        null;

      const layout = filterLayoutForRole(
        ensureOnboardingChecklist(active?.layout?.length ? active.layout : DEFAULT_DASHBOARD_LAYOUT),
        role,
      );

      return {
        role,
        canShareOrg: canWriteOrgDashboard(role),
        boards: boards.rows,
        active: active
          ? { ...active, layout }
          : {
              id: null,
              name: "Default home",
              scope: "personal" as const,
              isActive: true,
              layout,
              updatedAt: null,
              ownerUserId: session.user.id,
              isDefault: true,
            },
      };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      id?: string | null;
      name?: string;
      scope?: "personal" | "org";
      layout?: unknown;
      activate?: boolean;
      action?: "reset" | "save";
    };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await membership(client, orgId, session.user.id);
      const scope = body.scope === "org" ? "org" : "personal";
      if (scope === "org" && !canWriteOrgDashboard(role)) {
        throw new Error("Owner/admin access required to manage org dashboards");
      }

      if (body.action === "reset") {
        if (body.id) {
          await client.query(
            `UPDATE dashboards SET layout = $3::jsonb, updated_at = now()
             WHERE id = $1 AND org_id = $2
               AND (
                 (scope = 'personal' AND owner_user_id = $4)
                 OR (scope = 'org' AND $5)
               )`,
            [
              body.id,
              orgId,
              JSON.stringify(DEFAULT_DASHBOARD_LAYOUT),
              session.user.id,
              canWriteOrgDashboard(role),
            ],
          );
        }
        return {
          id: body.id ?? null,
          layout: filterLayoutForRole(DEFAULT_DASHBOARD_LAYOUT, role),
          reset: true,
        };
      }

      const validated = validateDashboardLayout(body.layout ?? DEFAULT_DASHBOARD_LAYOUT, role);
      if (!validated.ok) throw new Error(validated.error);
      const name = String(body.name ?? (scope === "org" ? "Team dashboard" : "My dashboard")).trim().slice(0, 80) || "My dashboard";
      const activate = body.activate !== false;

      if (activate) {
        if (scope === "personal") {
          await client.query(
            `UPDATE dashboards SET is_active = false, updated_at = now()
             WHERE org_id = $1 AND scope = 'personal' AND owner_user_id = $2`,
            [orgId, session.user.id],
          );
        } else {
          await client.query(
            `UPDATE dashboards SET is_active = false, updated_at = now()
             WHERE org_id = $1 AND scope = 'org'`,
            [orgId],
          );
        }
      }

      const row = await client.query<{ id: string }>(
        `INSERT INTO dashboards(id, org_id, owner_user_id, name, scope, is_active, layout, created_by)
         VALUES (
           COALESCE($1::uuid, gen_random_uuid()),
           $2,
           $3,
           $4,
           $5,
           $6,
           $7::jsonb,
           $8
         )
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           layout = excluded.layout,
           is_active = excluded.is_active,
           updated_at = now()
         RETURNING id`,
        [
          body.id ?? null,
          orgId,
          scope === "personal" ? session.user.id : null,
          name,
          scope,
          activate,
          JSON.stringify(validated.layout),
          session.user.id,
        ],
      );

      return {
        id: row.rows[0]!.id,
        layout: validated.layout,
        scope,
        name,
        isActive: activate,
      };
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { orgId?: string; id?: string };
    if (!body.orgId || !body.id) throw new Error("orgId and id are required");
    await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const role = await membership(client, body.orgId!, session.user.id);
      await client.query(
        `DELETE FROM dashboards
         WHERE id = $1 AND org_id = $2
           AND (
             (scope = 'personal' AND owner_user_id = $3)
             OR (scope = 'org' AND $4)
           )`,
        [body.id, body.orgId, session.user.id, canWriteOrgDashboard(role)],
      );
    });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
