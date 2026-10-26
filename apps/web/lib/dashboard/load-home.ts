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
  input: { orgId: string; userId: string; boardId?: string | null },
) {
  const memberP = client.query<{ role: string; teamRole: string | null }>(
    `SELECT m.role, p.team_role AS "teamRole"
       FROM memberships m
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.org_id = $1 AND m.user_id = $2
      LIMIT 1`,
    [input.orgId, input.userId],
  );
  const boardsP = client.query<BoardRow>(
    `SELECT id, name, scope, is_active AS "isActive", layout, updated_at::text AS "updatedAt",
            owner_user_id AS "ownerUserId"
       FROM dashboards
      WHERE org_id = $1
        AND (
          (scope = 'personal' AND owner_user_id = $2)
          OR scope = 'org'
        )
      ORDER BY scope DESC, is_active DESC, updated_at DESC`,
    [input.orgId, input.userId],
  );
  const [member, boards] = await Promise.all([memberP, boardsP]);
  if (!member.rowCount) throw new Error("Organization membership required");
  const role = member.rows[0]!.role;
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
      orgId: input.orgId,
      userId: input.userId,
      role,
      widgetTypes: [...new Set([...layout.map((item) => item.type), ...HOME_ALWAYS_LOADED])],
      includeHomeStrip: true,
    }),
    loadDataSourceHealth(client, input.orgId),
  ]);
  return {
    orgId: input.orgId,
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
