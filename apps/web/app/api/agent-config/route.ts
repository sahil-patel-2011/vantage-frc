import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import type { PoolClient } from "@neondatabase/serverless";
import {
  AGENT_CONFIG_KINDS,
  validateAgentConfigContent,
  type AgentConfigKind,
} from "../../../lib/agent-config/formats";
import {
  deleteAgentConfigItem,
  getAgentConfigSettings,
  hasSharingSchema,
  listAgentConfigItems,
  listAgentConfigRevisions,
  listOrgMemberOptions,
  restoreAgentConfigRevision,
  saveAgentConfigItem,
  setAgentConfigItemSharing,
  setAllowMemberEdits,
  type AgentConfigItem,
  type OrgMemberOption,
} from "../../../lib/agent-config/store";

export type AgentConfigView =
  | {
      status: "live";
      orgId: string;
      userId: string;
      role: "owner" | "admin" | "member";
      canEdit: boolean;
      allowMemberEdits: boolean;
      /** False until migration 0490 runs — the UI hides the sharing picker. */
      sharingReady: boolean;
      items: AgentConfigItem[];
      /** Org members for the "only specific people" picker. */
      members: OrgMemberOption[];
    }
  | { status: "setup_required"; message: string; orgId: null };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; role: "owner" | "admin" | "member" } | null> {
  const result = await client.query<{ orgId: string; role: "owner" | "admin" | "member" }>(
    `SELECT m.org_id AS "orgId", m.role
     FROM memberships m
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

async function computeView(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<AgentConfigView> {
  const membership = await resolveMembership(client, userId, requestedOrg);
  if (!membership) {
    return {
      status: "setup_required",
      message: "Select a team workspace to share agent configuration.",
      orgId: null,
    };
  }
  const settings = await getAgentConfigSettings(client, membership.orgId);
  const items = await listAgentConfigItems(client, membership.orgId);
  const sharingReady = await hasSharingSchema(client);
  const members = await listOrgMemberOptions(client, membership.orgId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  return {
    status: "live",
    orgId: membership.orgId,
    userId,
    role: membership.role,
    canEdit: isAdmin || settings.allowMemberEdits,
    allowMemberEdits: settings.allowMemberEdits,
    sharingReady,
    items,
    members,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeView(client, session.user.id, requestedOrg),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load agent configuration. Confirm database access and run migration 0487.",
        orgId: null,
      } satisfies AgentConfigView,
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
    const payload = await withRls({ userId, orgId }, async (client) => {
      const membership = await resolveMembership(client, userId, orgId);
      if (!membership) throw new Error("forbidden");

      switch (action) {
        case "validate": {
          // Live editor validation — no write, no role requirement beyond membership.
          const kind = body.kind as AgentConfigKind;
          if (!AGENT_CONFIG_KINDS.includes(kind)) throw new Error("Unknown kind");
          const content = typeof body.content === "string" ? body.content : "";
          return { validation: validateAgentConfigContent(kind, content) };
        }
        case "save-item": {
          const kind = body.kind as AgentConfigKind;
          if (!AGENT_CONFIG_KINDS.includes(kind)) throw new Error("Unknown kind");
          const name = trimmedOrNull(body.name, 64);
          if (!name) throw new Error("name is required");
          const content = typeof body.content === "string" ? body.content : "";
          if (!content) throw new Error("content is required");
          const saved = await saveAgentConfigItem(client, {
            orgId,
            userId,
            kind,
            name: name.toLowerCase(),
            description: trimmedOrNull(body.description, 500),
            content,
          });
          return { saved };
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const deleted = await deleteAgentConfigItem(client, { orgId, itemId });
          if (!deleted) throw new Error("Item not found or you do not have edit access");
          return {};
        }
        case "revisions": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          return { revisions: await listAgentConfigRevisions(client, { orgId, itemId }) };
        }
        case "restore-revision": {
          const itemId = trimmedOrNull(body.itemId, 64);
          const revisionId = trimmedOrNull(body.revisionId, 64);
          if (!itemId || !revisionId) throw new Error("itemId and revisionId are required");
          const saved = await restoreAgentConfigRevision(client, { orgId, userId, itemId, revisionId });
          return { saved };
        }
        case "set-sharing": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const visibility = body.visibility === "members" ? "members" : "team";
          const userIds = Array.isArray(body.userIds)
            ? body.userIds.filter((id): id is string => typeof id === "string").slice(0, 200)
            : [];
          await setAgentConfigItemSharing(client, { orgId, userId, itemId, visibility, userIds });
          return {};
        }
        case "set-allow-member-edits": {
          if (membership.role !== "owner" && membership.role !== "admin") throw new Error("forbidden");
          await setAllowMemberEdits(client, {
            orgId,
            userId,
            allowMemberEdits: body.allowMemberEdits === true,
          });
          return {};
        }
        default:
          throw new Error("Unknown action");
      }
    });

    const view = await withRls({ userId, orgId }, (client) => computeView(client, userId, orgId));
    return Response.json({ ...payload, view });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent config request failed";
    // RLS blocks non-editors as a zero-row write; surface it as access denied, not a mystery.
    const denied = message === "forbidden" || /row-level security/i.test(message);
    return Response.json(
      {
        error: denied
          ? "You do not have edit access. Ask a team owner/admin, or have them enable member edits."
          : message,
      },
      { status: denied ? 403 : 400 },
    );
  }
}
