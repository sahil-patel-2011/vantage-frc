// Pre-upload routing plan: given a selection of files (name, type, size), tell
// the user WHERE each one would go — team database, storage node, or refused —
// BEFORE any bytes move. The decisions come from the same pure function the
// grant route enforces, so the preview is never a different answer than the
// upload. Session-authenticated, org-scoped through withRls.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { cloudUploadCapBytes } from "../../../../lib/storage-routing/caps";
import { planFiles } from "../../../../lib/storage-routing/decide";
import { loadCandidateNode, loadRoutingPolicy } from "../../../../lib/storage-routing/store";
import type { StoragePlanFile, StoragePlanResult } from "../../../../lib/storage-routing/types";

const MAX_PLAN_FILES = 200;

function parseFiles(value: unknown): StoragePlanFile[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_FILES) return null;
  const files: StoragePlanFile[] = [];
  for (const entry of value) {
    if (entry == null || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.slice(0, 255) : "";
    const contentType = typeof record.contentType === "string" ? record.contentType.slice(0, 255) : "";
    const byteSize = Number(record.byteSize);
    if (!name || !Number.isFinite(byteSize) || byteSize < 0) return null;
    files.push({ name, contentType, byteSize: Math.round(byteSize) });
  }
  return files;
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
  const files = parseFiles(body.files);
  if (!files) {
    return Response.json({ error: `files must be 1-${MAX_PLAN_FILES} entries of {name, contentType, byteSize}` }, { status: 400 });
  }

  const userId = session.user.id;
  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      const nowMs = Date.now();
      const [{ policy }, node] = await Promise.all([
        loadRoutingPolicy(client, orgId),
        loadCandidateNode(client, orgId, nowMs),
      ]);
      const cloudCapBytes = cloudUploadCapBytes();
      const entries = planFiles(files, policy, node, cloudCapBytes);
      return { orgId, cloudCapBytes, policy, node, entries } satisfies StoragePlanResult;
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage plan failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json({ error: message === "forbidden" ? "Organization access denied" : message }, { status });
  }
}
