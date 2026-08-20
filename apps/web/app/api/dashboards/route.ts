import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { pickHomeBoard } from "../../../lib/dashboard/boards";
import {
  canWriteOrgDashboard,
  catalogEntry,
  DEFAULT_DASHBOARD_LAYOUT,
  filterLayoutForRole,
  validateDashboardLayout,
  type DashboardWidgetLayout,
} from "../../../lib/dashboard/catalog";
import { loadDashboardSnapshot } from "../../../lib/dashboard/snapshot";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";

const MAX_BOARDS_PER_SCOPE = 12;

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

type BoardRow = {
  id: string;
  name: string;
  scope: "personal" | "org";
  isActive: boolean;
  layout: DashboardWidgetLayout[];
  updatedAt: string;
  ownerUserId: string | null;
};

async function listBoards(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
  userId: string,
) {
  return client.query<BoardRow>(
    `SELECT id, name, scope, is_active AS "isActive", layout, updated_at::text AS "updatedAt",
            owner_user_id AS "ownerUserId"
     FROM dashboards
     WHERE org_id = $1
       AND (
         (scope = 'personal' AND owner_user_id = $2)
         OR scope = 'org'
       )
     ORDER BY scope DESC, is_active DESC, updated_at DESC`,
    [orgId, userId],
  );
}


async function deactivateForSwitch(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
  userId: string,
  scope: "personal" | "org",
) {
  // Clear personal actives so an org board can surface (GET prefers personal).
  await client.query(
    `UPDATE dashboards SET is_active = false, updated_at = now()
     WHERE org_id = $1 AND scope = 'personal' AND owner_user_id = $2 AND is_active = true`,
    [orgId, userId],
  );
  if (scope === "org") {
    await client.query(
      `UPDATE dashboards SET is_active = false, updated_at = now()
       WHERE org_id = $1 AND scope = 'org' AND is_active = true`,
      [orgId],
    );
  }
}

async function countBoards(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
  userId: string,
  scope: "personal" | "org",
) {
  const result = await client.query<{ count: string }>(
    scope === "personal"
      ? `SELECT count(*)::text AS count FROM dashboards
         WHERE org_id = $1 AND scope = 'personal' AND owner_user_id = $2`
      : `SELECT count(*)::text AS count FROM dashboards
         WHERE org_id = $1 AND scope = 'org'`,
    scope === "personal" ? [orgId, userId] : [orgId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const mode = url.searchParams.get("mode") ?? "list";
    const boardId = url.searchParams.get("boardId");
    if (!orgId) throw new Error("orgId is required");
    if (mode === "snapshot") {
      await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg: orgId });
    }

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await membership(client, orgId, session.user.id);

      if (mode === "snapshot") {
        const snapshot = await loadDashboardSnapshot(client, {
          orgId,
          userId: session.user.id,
          role,
        });
        const { loadDataSourceHealth } = await import("../../../lib/reference-health");
        const dataSourceHealth = await loadDataSourceHealth(client, orgId);
        return {
          role,
          ...snapshot,
          context: { ...snapshot.context, dataSourceHealth },
        };
      }

      const boards = await listBoards(client, orgId, session.user.id);
      const active = pickHomeBoard(boards.rows, {
        userId: session.user.id,
        preferredId: boardId,
      });

      const layout = filterLayoutForRole(
        ensureOnboardingChecklist(active?.layout?.length ? active.layout : DEFAULT_DASHBOARD_LAYOUT),
        role,
      );

      return {
        role,
        canShareOrg: canWriteOrgDashboard(role),
        boards: boards.rows.map(({ layout: _layout, ...meta }) => meta),
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
      action?: "reset" | "save" | "activate" | "rename" | "create";
    };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const action = body.action ?? "save";

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await membership(client, orgId, session.user.id);
      const scope = body.scope === "org" ? "org" : "personal";

      if (action === "reset") {
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

      if (action === "rename") {
        const id = String(body.id ?? "");
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (!id || !name) throw new Error("id and name are required");
        const updated = await client.query<{ id: string; name: string; scope: "personal" | "org" }>(
          `UPDATE dashboards SET name = $3, updated_at = now()
           WHERE id = $1 AND org_id = $2
             AND (
               (scope = 'personal' AND owner_user_id = $4)
               OR (scope = 'org' AND $5)
             )
           RETURNING id, name, scope`,
          [id, orgId, name, session.user.id, canWriteOrgDashboard(role)],
        );
        if (!updated.rowCount) throw new Error("Board not found or not editable");
        return { id: updated.rows[0]!.id, name: updated.rows[0]!.name, scope: updated.rows[0]!.scope, renamed: true };
      }

      if (action === "activate") {
        const id = String(body.id ?? "");
        if (!id) throw new Error("id is required");
        const existing = await client.query<BoardRow>(
          `SELECT id, name, scope, is_active AS "isActive", layout, updated_at::text AS "updatedAt",
                  owner_user_id AS "ownerUserId"
           FROM dashboards
           WHERE id = $1 AND org_id = $2
             AND (
               (scope = 'personal' AND owner_user_id = $3)
               OR scope = 'org'
             )
           LIMIT 1`,
          [id, orgId, session.user.id],
        );
        const board = existing.rows[0];
        if (!board) throw new Error("Board not found");

        if (board.scope === "org" && !canWriteOrgDashboard(role)) {
          // Members can view any team board without rewriting the org-wide active flag.
          await client.query(
            `UPDATE dashboards SET is_active = false, updated_at = now()
             WHERE org_id = $1 AND scope = 'personal' AND owner_user_id = $2 AND is_active = true`,
            [orgId, session.user.id],
          );
        } else {
          await deactivateForSwitch(client, orgId, session.user.id, board.scope);
          await client.query(
            `UPDATE dashboards SET is_active = true, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [id, orgId],
          );
        }

        const layout = filterLayoutForRole(
          ensureOnboardingChecklist(board.layout?.length ? board.layout : DEFAULT_DASHBOARD_LAYOUT),
          role,
        );
        return {
          id: board.id,
          name: board.name,
          scope: board.scope,
          layout,
          isActive: true,
          activated: true,
        };
      }

      if (action === "create") {
        if (scope === "org" && !canWriteOrgDashboard(role)) {
          throw new Error("Owner/admin access required to manage org dashboards");
        }
        const existingCount = await countBoards(client, orgId, session.user.id, scope);
        if (existingCount >= MAX_BOARDS_PER_SCOPE) {
          throw new Error(`At most ${MAX_BOARDS_PER_SCOPE} ${scope === "org" ? "team" : "personal"} boards`);
        }
        const validated = validateDashboardLayout(body.layout ?? DEFAULT_DASHBOARD_LAYOUT, role);
        if (!validated.ok) throw new Error(validated.error);
        const name =
          String(body.name ?? (scope === "org" ? "Team board" : "My board")).trim().slice(0, 80) ||
          (scope === "org" ? "Team board" : "My board");
        const activate = body.activate !== false;
        if (activate) await deactivateForSwitch(client, orgId, session.user.id, scope);

        const row = await client.query<{ id: string }>(
          `INSERT INTO dashboards(id, org_id, owner_user_id, name, scope, is_active, layout, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7)
           RETURNING id`,
          [
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
          layout: filterLayoutForRole(validated.layout, role),
          scope,
          name,
          isActive: activate,
          created: true,
        };
      }

      // save (default)
      if (scope === "org" && !canWriteOrgDashboard(role)) {
        throw new Error("Owner/admin access required to manage org dashboards");
      }

      const validated = validateDashboardLayout(body.layout ?? DEFAULT_DASHBOARD_LAYOUT, role);
      if (!validated.ok) throw new Error(validated.error);
      const name =
        String(body.name ?? (scope === "org" ? "Team dashboard" : "My dashboard")).trim().slice(0, 80) ||
        "My dashboard";
      const activate = body.activate !== false;

      if (!body.id) {
        const existingCount = await countBoards(client, orgId, session.user.id, scope);
        if (existingCount >= MAX_BOARDS_PER_SCOPE) {
          throw new Error(`At most ${MAX_BOARDS_PER_SCOPE} ${scope === "org" ? "team" : "personal"} boards`);
        }
      }

      if (activate) await deactivateForSwitch(client, orgId, session.user.id, scope);

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

    return Response.json(result, { status: action === "rename" || action === "activate" ? 200 : 201 });
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { orgId?: string; id?: string };
    if (!body.orgId || !body.id) throw new Error("orgId and id are required");

    const result = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const role = await membership(client, body.orgId!, session.user.id);
      const existing = await client.query<{ id: string; scope: "personal" | "org"; isActive: boolean }>(
        `SELECT id, scope, is_active AS "isActive"
         FROM dashboards
         WHERE id = $1 AND org_id = $2
           AND (
             (scope = 'personal' AND owner_user_id = $3)
             OR (scope = 'org' AND $4)
           )
         LIMIT 1`,
        [body.id, body.orgId, session.user.id, canWriteOrgDashboard(role)],
      );
      const board = existing.rows[0];
      if (!board) throw new Error("Board not found or not deletable");

      await client.query(
        `DELETE FROM dashboards
         WHERE id = $1 AND org_id = $2
           AND (
             (scope = 'personal' AND owner_user_id = $3)
             OR (scope = 'org' AND $4)
           )`,
        [body.id, body.orgId, session.user.id, canWriteOrgDashboard(role)],
      );

      let activatedId: string | null = null;
      if (board.isActive) {
        const fallback = await client.query<{ id: string; scope: "personal" | "org" }>(
          `SELECT id, scope FROM dashboards
           WHERE org_id = $1
             AND (
               (scope = 'personal' AND owner_user_id = $2)
               OR scope = 'org'
             )
           ORDER BY
             CASE WHEN scope = $3 THEN 0 ELSE 1 END,
             updated_at DESC
           LIMIT 1`,
          [body.orgId, session.user.id, board.scope],
        );
        if (fallback.rows[0]) {
          await deactivateForSwitch(client, body.orgId!, session.user.id, fallback.rows[0].scope);
          await client.query(
            `UPDATE dashboards SET is_active = true, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [fallback.rows[0].id, body.orgId],
          );
          activatedId = fallback.rows[0].id;
        }
      }

      return { ok: true, activatedId };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
