// Storage routing policy: view (any member) and change (owners/admins — also
// enforced by RLS WITH CHECK on storage_routing_policies). The view includes
// real per-location usage sums so /team/storage can show where bytes actually
// live; nothing here is projected or invented.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { cloudUploadCapBytes } from "../../../../lib/storage-routing/caps";
import { normalizeRoutingPolicy } from "../../../../lib/storage-routing/policy";
import {
  loadRoutingPolicy,
  loadStorageUsage,
  saveRoutingPolicy,
} from "../../../../lib/storage-routing/store";
import type { StoragePolicyView } from "../../../../lib/storage-routing/types";

async function buildView(
  client: Parameters<typeof loadRoutingPolicy>[0],
  orgId: string,
  userId: string,
): Promise<StoragePolicyView> {
  const [{ policy, customized }, usage, roleResult] = await Promise.all([
    loadRoutingPolicy(client, orgId),
    loadStorageUsage(client, orgId),
    client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2 LIMIT 1`,
      [orgId, userId],
    ),
  ]);
  const role = roleResult.rows[0]?.role ?? "";
  return {
    orgId,
    policy,
    customized,
    canManage: role === "owner" || role === "admin",
    cloudCapBytes: cloudUploadCapBytes(),
    usage,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId")?.trim().slice(0, 64) ?? "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");
      return buildView(client, orgId, userId);
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the storage policy";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json({ error: message === "forbidden" ? "Organization access denied" : message }, { status });
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
  const orgId = typeof body.orgId === "string" ? body.orgId.trim().slice(0, 64) : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2 LIMIT 1`,
        [orgId, userId],
      );
      const role = member.rows[0]?.role;
      if (!role) throw new Error("forbidden");
      if (role !== "owner" && role !== "admin") throw new Error("manage-denied");

      const policy = normalizeRoutingPolicy(body.policy);
      await saveRoutingPolicy(client, { orgId, userId, policy });
      return buildView(client, orgId, userId);
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the storage policy";
    if (message === "forbidden") return Response.json({ error: "Organization access denied" }, { status: 403 });
    if (message === "manage-denied") {
      return Response.json({ error: "Only team owners/admins can change the storage policy" }, { status: 403 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
