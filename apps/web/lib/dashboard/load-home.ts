import type { PoolClient } from "@neondatabase/serverless";
import { pickHomeBoard } from "./boards";
import {
  canWriteOrgDashboard,
  defaultDashboardLayoutForAudience,
  filterLayoutForRole,
  type DashboardWidgetLayout,
} from "./catalog";
import { homeAudienceFromTeamRole } from "../home-workflows";
import { HOME_ALWAYS_LOADED } from "./refresh";
import { loadDashboardSnapshot } from "./snapshot";
import { loadDataSourceHealth } from "../reference-health";

type BoardRow = {
  id: string;
  name: string;
  scope: "personal" | "org";
  isActive: boolean;
  layout: DashboardWidgetLayout[];
  updatedAt: string;
  ownerUserId: string | null;
};

/**
 * Home's first paint: membership, the saved board, and every card, in as few
 * round trips as the dependencies allow.
 */
export async function loadHomePaint(
  client: PoolClient,
  input: { orgId: string | null; userId: string; boardId?: string | null },
) {
  const requested = input.orgId || null;
  const memberP = client.query<{ orgId: string; role: string; teamRole: string | null }>(
    `SELECT m.org_id AS "orgId", m.role, p.team_role AS "teamRole"
       FROM memberships m
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.user_id = $2::uuid
        AND ($1::uuid IS NULL OR m.org_id = $1::uuid)
      ORDER BY CASE WHEN m.org_id = $1::uuid THEN 0 ELSE 1 END,
               CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
      LIMIT 1`,
    [requested, input.userId],
  );
  const boardsP = client.query<BoardRow>(
    `SELECT id, name, scope, is_active AS "isActive", layout, updated_at::text AS "updatedAt",
            owner_user_id AS "ownerUserId"
       FROM dashboards
      WHERE org_id = COALESCE($1::uuid, (
              SELECT m.org_id FROM memberships m
               WHERE m.user_id = $2::uuid
               ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
               LIMIT 1
            ))
        AND (
          (scope = 'personal' AND owner_user_id = $2)
          OR scope = 'org'
        )
      ORDER BY scope DESC, is_active DESC, updated_at DESC`,
    [requested, input.userId],
  );
  const [member, boards] = await Promise.all([memberP, boardsP]);
  if (!member.rowCount) throw new Error("Organization membership required");
  const orgId = member.rows[0]!.orgId;
  const role = member.rows[0]!.role;
  // The session opened without a team. Later reads in this transaction follow the membership.
  if (!requested) {
    void client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
  }
  const active = pickHomeBoard(boards.rows, {
    userId: input.userId,
    preferredId: input.boardId,
  });
  const layout = filterLayoutForRole(
    Array.isArray(active?.layout) && active.layout.length
      ? active.layout
      : defaultDashboardLayoutForAudience(homeAudienceFromTeamRole(member.rows[0]?.teamRole)),
    role,
  );
  const [snapshot, dataSourceHealth] = await Promise.all([
    loadDashboardSnapshot(client, {
      orgId,
      userId: input.userId,
      role,
      widgetTypes: [...new Set([...layout.map((item) => item.type), ...HOME_ALWAYS_LOADED])],
      includeHomeStrip: true,
    }),
    loadDataSourceHealth(client, orgId),
  ]);
  return {
    orgId,
    userId: input.userId,
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
          ownerUserId: input.userId,
          isDefault: true,
        },
    ...snapshot,
    context: { ...snapshot.context, dataSourceHealth },
  };
}
