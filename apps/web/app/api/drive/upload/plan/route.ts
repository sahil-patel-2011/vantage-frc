// Pre-upload routing plan for Vantage Drive: for a whole selection of files,
// say WHERE each one is going — the team database, the team's storage node, or
// object storage — and why, BEFORE any bytes move. Same pure function the
// grant route enforces, extended with the object-storage destination, so the
// preview is never a different answer than the upload.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../../lib/drive/api";
import { cloudUploadCapBytes } from "../../../../../lib/storage-routing/caps";
import { planFiles } from "../../../../../lib/storage-routing/decide";
import { objectStoreStatus } from "../../../../../lib/storage-routing/object-store";
import { loadCandidateNode, loadRoutingPolicy } from "../../../../../lib/storage-routing/store";
import type { StoragePlanFile } from "../../../../../lib/storage-routing/types";

export const dynamic = "force-dynamic";

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
  try {
    const session = await requireDriveSession();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new DriveHttpError(400, "Invalid JSON body");
    }
    const files = parseFiles(body.files);
    if (!files) {
      throw new DriveHttpError(
        400,
        `files must be 1-${MAX_PLAN_FILES} entries of {name, contentType, byteSize}`,
      );
    }
    const requestedOrgId = readUuid(body.orgId);

    const objectStore = objectStoreStatus();
    const result = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        const [{ policy }, node] = await Promise.all([
          loadRoutingPolicy(client, orgId),
          loadCandidateNode(client, orgId, Date.now()),
        ]);
        const cloudCapBytes = cloudUploadCapBytes();
        return {
          orgId,
          cloudCapBytes,
          policy,
          node,
          // Say plainly whether object storage exists for this deployment, and
          // which env vars are missing if it does not — the UI shows that
          // sentence rather than a vague "upload failed" at the end.
          objectStorage: objectStore.configured
            ? { status: "ready" as const }
            : { status: "setup_required" as const, reason: objectStore.reason, missing: objectStore.missing },
          entries: planFiles(
            files,
            policy,
            node,
            cloudCapBytes,
            objectStore.configured ? { configured: true } : { configured: false, reason: objectStore.reason },
          ),
        };
      },
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
