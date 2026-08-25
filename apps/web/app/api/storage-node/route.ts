// /team/storage backend: view + node management (rename, set/clear base URL, unpair).
// Session-authenticated, org-scoped through withRls; all liveness in the view is derived from
// heartbeats, never trusted from a column.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { normalizeBaseUrl } from "../../../lib/storage-node";
import { computeStorageNodeView, type StorageNodeViewData } from "../../../lib/storage-node/compute-storage-view";

export type { StorageNodeViewData };

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeStorageNodeView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load storage nodes. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies StorageNodeViewData,
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
  const nodeId = trimmedOrNull(body.nodeId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!nodeId) return Response.json({ error: "nodeId is required" }, { status: 400 });

  const userId = session.user.id;
  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "rename": {
          const name = trimmedOrNull(body.name, 100);
          if (!name) throw new Error("name is required");
          const updated = await client.query(
            `UPDATE storage_nodes SET name = $3, updated_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
            [nodeId, orgId, name],
          );
          if (!updated.rowCount) throw new Error("manage-denied");
          break;
        }
        case "set-base-url": {
          const raw = body.baseUrl;
          if (raw == null || raw === "") {
            const cleared = await client.query(
              `UPDATE storage_nodes SET base_url = NULL, updated_at = now()
               WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
              [nodeId, orgId],
            );
            if (!cleared.rowCount) throw new Error("manage-denied");
            break;
          }
          const baseUrl = normalizeBaseUrl(raw);
          if (!baseUrl) throw new Error("Base URL must be a plain http(s) URL with no query, hash, or credentials");
          const updated = await client.query(
            `UPDATE storage_nodes SET base_url = $3, updated_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
            [nodeId, orgId, baseUrl],
          );
          if (!updated.rowCount) throw new Error("manage-denied");
          break;
        }
        case "unpair": {
          const updated = await client.query(
            `UPDATE storage_nodes SET revoked_at = now(), base_url = NULL, updated_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
            [nodeId, orgId],
          );
          if (!updated.rowCount) throw new Error("manage-denied");
          break;
        }
        default:
          throw new Error("Unknown action");
      }
      return computeStorageNodeView(client, { userId, requestedOrg: orgId });
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage node request failed";
    if (message === "forbidden") return Response.json({ error: "Organization access denied" }, { status: 403 });
    if (message === "manage-denied") {
      // RLS update policy: owner/admin or the member who paired the node.
      return Response.json(
        { error: "Only team owners/admins (or whoever paired this node) can manage it" },
        { status: 403 },
      );
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
