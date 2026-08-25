import type { PoolClient } from "@neondatabase/serverless";
import {
  parseMcpServer,
  parsePermissions,
  validateAgentConfigContent,
  validateAgentConfigName,
  type AgentConfigKind,
  type McpServerEntry,
  type PermissionsSnippet,
} from "./formats";

/**
 * RLS-scoped data access for team-shared agent configuration.
 * All queries run on the withRls PoolClient — org membership and the
 * owner/admin (or allow_member_edits) write gate are enforced by the
 * policies in migration 0487; this module adds format validation and
 * revision history on top.
 */

export type AgentConfigVisibility = "team" | "members";

export type AgentConfigItem = {
  id: string;
  kind: AgentConfigKind;
  name: string;
  description: string | null;
  content: string;
  formatValid: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  /** 'team' = every member; 'members' = creator + granted members + owners/admins (migration 0490). */
  visibility: AgentConfigVisibility;
  createdBy: string;
  /** User ids individually granted access ('members' visibility only). */
  sharedWith: string[];
};

export type AgentConfigRevision = {
  id: string;
  version: number;
  content: string;
  updatedBy: string;
  createdAt: string;
};

// Base columns are RETURNING-safe; the sharedWith grant array is a correlated
// subquery and is only used in plain SELECTs.
const SAVE_COLUMNS = `id, kind, name, description, content,
       format_valid AS "formatValid", version, updated_by AS "updatedBy",
       updated_at::text AS "updatedAt",
       visibility, created_by AS "createdBy", '{}'::uuid[] AS "sharedWith"`;

const ITEM_COLUMNS = `id, kind, name, description, content,
       format_valid AS "formatValid", version, updated_by AS "updatedBy",
       updated_at::text AS "updatedAt",
       visibility, created_by AS "createdBy",
       COALESCE((SELECT array_agg(g.user_id ORDER BY g.created_at)
                 FROM agent_config_item_grants g
                 WHERE g.item_id = agent_config_items.id), '{}'::uuid[]) AS "sharedWith"`;

// Pre-0490 fallback: before the sharing migration runs, every item behaves as
// team-wide. Reads degrade gracefully; sharing WRITES require the migration.
const LEGACY_ITEM_COLUMNS = `id, kind, name, description, content,
       format_valid AS "formatValid", version, updated_by AS "updatedBy",
       updated_at::text AS "updatedAt",
       'team' AS visibility, updated_by AS "createdBy", '{}'::uuid[] AS "sharedWith"`;

// withRls is one transaction, so a failed query would abort it — probe the
// schema instead of catch-and-retry. Only a positive result is cached: a
// "false" is re-probed so applying 0490 takes effect without a restart.
let sharingSchemaReady = false;

export async function hasSharingSchema(client: PoolClient): Promise<boolean> {
  if (sharingSchemaReady) return true;
  const probe = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_config_items' AND column_name = 'visibility'
     LIMIT 1`,
  );
  sharingSchemaReady = (probe.rowCount ?? 0) > 0;
  return sharingSchemaReady;
}

export async function listAgentConfigItems(
  client: PoolClient,
  orgId: string,
): Promise<AgentConfigItem[]> {
  const columns = (await hasSharingSchema(client)) ? ITEM_COLUMNS : LEGACY_ITEM_COLUMNS;
  const result = await client.query<AgentConfigItem>(
    `SELECT ${columns} FROM agent_config_items WHERE org_id = $1::uuid ORDER BY kind, name`,
    [orgId],
  );
  return result.rows;
}

export type OrgMemberOption = { userId: string; name: string; role: string };

/** Org members for the sharing picker (memberships RLS: members see co-members). */
export async function listOrgMemberOptions(
  client: PoolClient,
  orgId: string,
): Promise<OrgMemberOption[]> {
  const result = await client.query<OrgMemberOption>(
    `SELECT m.user_id AS "userId", COALESCE(u.name, u.email) AS name, m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY lower(COALESCE(u.name, u.email)), u.email
     LIMIT 500`,
    [orgId],
  );
  return result.rows;
}

export async function getAgentConfigSettings(
  client: PoolClient,
  orgId: string,
): Promise<{ allowMemberEdits: boolean }> {
  const result = await client.query<{ allowMemberEdits: boolean }>(
    `SELECT allow_member_edits AS "allowMemberEdits" FROM agent_config_settings WHERE org_id = $1::uuid`,
    [orgId],
  );
  return { allowMemberEdits: result.rows[0]?.allowMemberEdits ?? false };
}

export async function setAllowMemberEdits(
  client: PoolClient,
  input: { orgId: string; userId: string; allowMemberEdits: boolean },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_config_settings(org_id, allow_member_edits, updated_by)
     VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT (org_id) DO UPDATE
       SET allow_member_edits = EXCLUDED.allow_member_edits,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [input.orgId, input.allowMemberEdits, input.userId],
  );
}

/**
 * Create or update an item. Invalid content still saves (format_valid=false,
 * badged in the UI and excluded from sync bundles) — validity problems are
 * returned so the editor can show them; only structural errors throw.
 */
export async function saveAgentConfigItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    kind: AgentConfigKind;
    name: string;
    description: string | null;
    content: string;
  },
): Promise<{ item: AgentConfigItem; problems: string[] }> {
  const nameCheck = validateAgentConfigName(input.name);
  if (!nameCheck.ok) throw new Error(nameCheck.problems[0]);
  const validation = validateAgentConfigContent(input.kind, input.content);

  const sharing = await hasSharingSchema(client);
  // created_by is pinned to the caller on INSERT and never changed by the
  // upsert path — the 0490 policies key creator visibility off it. Visibility
  // itself is managed separately via setAgentConfigItemSharing.
  const result = sharing
    ? await client.query<AgentConfigItem>(
        `INSERT INTO agent_config_items(org_id, kind, name, description, content, format_valid, updated_by, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $7::uuid)
         ON CONFLICT (org_id, kind, name) DO UPDATE
           SET description = EXCLUDED.description,
               content = EXCLUDED.content,
               format_valid = EXCLUDED.format_valid,
               version = agent_config_items.version + 1,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING ${SAVE_COLUMNS}`,
        [input.orgId, input.kind, input.name, input.description, input.content, validation.ok, input.userId],
      )
    : await client.query<AgentConfigItem>(
        `INSERT INTO agent_config_items(org_id, kind, name, description, content, format_valid, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
         ON CONFLICT (org_id, kind, name) DO UPDATE
           SET description = EXCLUDED.description,
               content = EXCLUDED.content,
               format_valid = EXCLUDED.format_valid,
               version = agent_config_items.version + 1,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING ${LEGACY_ITEM_COLUMNS}`,
        [input.orgId, input.kind, input.name, input.description, input.content, validation.ok, input.userId],
      );
  const item = result.rows[0]!;
  if (sharing && item.visibility === "members") {
    const grants = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM agent_config_item_grants
       WHERE item_id = $1::uuid ORDER BY created_at`,
      [item.id],
    );
    item.sharedWith = grants.rows.map((row) => row.userId);
  }
  await client.query(
    `INSERT INTO agent_config_revisions(org_id, item_id, version, content, updated_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
     ON CONFLICT (item_id, version) DO NOTHING`,
    [input.orgId, item.id, item.version, item.content, input.userId],
  );
  return { item, problems: validation.problems };
}

/**
 * Set an item's sharing scope: 'team' (everyone; grants cleared) or 'members'
 * (creator + the given user ids + owners/admins). The 0490 policies enforce
 * that only editors who can SEE the item can change it, and that grantees are
 * real org members (double-checked here via the memberships join).
 */
export async function setAgentConfigItemSharing(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    visibility: AgentConfigVisibility;
    userIds: string[];
  },
): Promise<void> {
  if (!(await hasSharingSchema(client))) {
    throw new Error("Sharing scopes are not set up yet — run migration 0490.");
  }
  // updated_by must be set to the caller to satisfy the UPDATE policy's check.
  const updated = await client.query(
    `UPDATE agent_config_items
     SET visibility = $3, updated_by = $4::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.itemId, input.orgId, input.visibility, input.userId],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new Error("Item not found or you do not have edit access");
  }
  const keep = input.visibility === "members" ? input.userIds : [];
  await client.query(
    `DELETE FROM agent_config_item_grants
     WHERE item_id = $1::uuid AND org_id = $2::uuid AND NOT (user_id = ANY($3::uuid[]))`,
    [input.itemId, input.orgId, keep],
  );
  if (keep.length) {
    await client.query(
      `INSERT INTO agent_config_item_grants(org_id, item_id, user_id, granted_by)
       SELECT $2::uuid, $1::uuid, m.user_id, $4::uuid
       FROM memberships m
       WHERE m.org_id = $2::uuid AND m.user_id = ANY($3::uuid[])
       ON CONFLICT (item_id, user_id) DO NOTHING`,
      [input.itemId, input.orgId, keep, input.userId],
    );
  }
}

export async function deleteAgentConfigItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM agent_config_items WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.itemId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listAgentConfigRevisions(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<AgentConfigRevision[]> {
  const result = await client.query<AgentConfigRevision>(
    `SELECT id, version, content, updated_by AS "updatedBy", created_at::text AS "createdAt"
     FROM agent_config_revisions
     WHERE item_id = $1::uuid AND org_id = $2::uuid
     ORDER BY version DESC
     LIMIT 50`,
    [input.itemId, input.orgId],
  );
  return result.rows;
}

/** Restore = re-save the old revision's content as a NEW version (history stays intact). */
export async function restoreAgentConfigRevision(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; revisionId: string },
): Promise<{ item: AgentConfigItem; problems: string[] }> {
  const revision = await client.query<{ content: string; kind: AgentConfigKind; name: string; description: string | null }>(
    `SELECT r.content, i.kind, i.name, i.description
     FROM agent_config_revisions r
     JOIN agent_config_items i ON i.id = r.item_id
     WHERE r.id = $1::uuid AND r.item_id = $2::uuid AND r.org_id = $3::uuid`,
    [input.revisionId, input.itemId, input.orgId],
  );
  const row = revision.rows[0];
  if (!row) throw new Error("Revision not found");
  return saveAgentConfigItem(client, {
    orgId: input.orgId,
    userId: input.userId,
    kind: row.kind,
    name: row.name,
    description: row.description,
    content: row.content,
  });
}

// ---------------------------------------------------------------------------
// Bundle — the typed export every agent consumes (docs/AGENT_CONFIG.md)
// ---------------------------------------------------------------------------

export type AgentConfigBundle = {
  schema: "vantage.agent-config/v1";
  orgId: string;
  generatedAt: string;
  rules: Array<{ name: string; description: string | null; markdown: string; version: number }>;
  subagents: Array<{ name: string; description: string | null; markdown: string; version: number }>;
  mcpServers: Array<{ name: string; description: string | null; entry: McpServerEntry; version: number }>;
  permissions: Array<{ name: string; description: string | null; snippet: PermissionsSnippet; version: number }>;
  skills: Array<{ name: string; description: string | null; markdown: string; version: number }>;
};

type BundleRow = Pick<AgentConfigItem, "kind" | "name" | "description" | "content" | "version" | "formatValid">;

export type ScopedBundleRow = BundleRow &
  Pick<AgentConfigItem, "visibility" | "createdBy" | "sharedWith">;

/**
 * Pure sharing-scope filter for bundles: a user's bundle carries team-wide
 * items plus 'members'-restricted items they created or were granted. This
 * intentionally applies to owners/admins too — they can SEE restricted items
 * for management (RLS), but their own sync bundle only carries what is theirs.
 */
export function bundleRowVisibleToUser(row: ScopedBundleRow, userId: string): boolean {
  return row.visibility === "team" || row.createdBy === userId || row.sharedWith.includes(userId);
}

export function filterBundleRowsForUser(rows: ScopedBundleRow[], userId: string): ScopedBundleRow[] {
  return rows.filter((row) => bundleRowVisibleToUser(row, userId));
}

/** Pure: only format-valid rows make it into the bundle; JSON kinds are parsed. */
export function shapeAgentConfigBundle(
  orgId: string,
  rows: BundleRow[],
  now: () => Date = () => new Date(),
): AgentConfigBundle {
  const bundle: AgentConfigBundle = {
    schema: "vantage.agent-config/v1",
    orgId,
    generatedAt: now().toISOString(),
    rules: [],
    subagents: [],
    mcpServers: [],
    permissions: [],
    skills: [],
  };
  for (const row of rows) {
    if (!row.formatValid) continue;
    const base = { name: row.name, description: row.description, version: row.version };
    if (row.kind === "rules") bundle.rules.push({ ...base, markdown: row.content });
    else if (row.kind === "subagent") bundle.subagents.push({ ...base, markdown: row.content });
    else if (row.kind === "skill") bundle.skills.push({ ...base, markdown: row.content });
    else if (row.kind === "mcp-server") {
      // Normalize through the parser so a pasted {mcpServers:{name:{...}}} wrapper
      // becomes the bare entry every consumer expects.
      const { entry } = parseMcpServer(row.content);
      if (entry) bundle.mcpServers.push({ ...base, entry });
    } else if (row.kind === "permissions") {
      const { permissions } = parsePermissions(row.content);
      if (permissions) bundle.permissions.push({ ...base, snippet: permissions });
    }
  }
  return bundle;
}

export async function buildAgentConfigBundle(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<AgentConfigBundle> {
  if (!(await hasSharingSchema(client))) {
    // Pre-0490: no sharing scopes exist, every item is team-wide.
    const rows = await client.query<BundleRow>(
      `SELECT kind, name, description, content, version, format_valid AS "formatValid"
       FROM agent_config_items
       WHERE org_id = $1::uuid
       ORDER BY kind, name`,
      [orgId],
    );
    return shapeAgentConfigBundle(orgId, rows.rows);
  }
  // RLS already hides restricted items from non-granted members; the explicit
  // filter additionally keeps other people's restricted items out of
  // owner/admin bundles (they can see them, but should not sync them).
  const rows = await client.query<ScopedBundleRow>(
    `SELECT kind, name, description, content, version, format_valid AS "formatValid",
            visibility, created_by AS "createdBy",
            COALESCE((SELECT array_agg(g.user_id)
                      FROM agent_config_item_grants g
                      WHERE g.item_id = agent_config_items.id), '{}'::uuid[]) AS "sharedWith"
     FROM agent_config_items
     WHERE org_id = $1::uuid
     ORDER BY kind, name`,
    [orgId],
  );
  return shapeAgentConfigBundle(orgId, filterBundleRowsForUser(rows.rows, userId));
}
