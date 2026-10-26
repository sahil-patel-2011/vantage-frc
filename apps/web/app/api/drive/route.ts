// Vantage Drive listing: the folder tree and files for one scope, plus the
// real per-location byte totals. Session-authenticated and org-scoped through
// withRls — the RLS policies in 0641 decide what comes back, and the personal
// scope is invisible to everyone but its owner including owners and admins.

import type { PoolClient } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import {
  driveErrorResponse,
  readString,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../lib/drive/api";
import {
  folderBreadcrumbs,
  listFiles,
  listFolders,
  listRecentFiles,
  listSharedWithMe,
  listTrashedFiles,
  loadDriveUsage,
  loadVirtualFolders,
} from "../../../lib/drive/store";
import { isDriveScope } from "../../../lib/drive/validation";
import type { DriveListing, DriveScope } from "../../../lib/drive/types";

export const dynamic = "force-dynamic";

export async function loadDriveListing(
  client: PoolClient,
  input: {
    userId: string;
    email: string | null;
    requestedOrgId: string | null;
    scope: DriveScope;
    folderId: string | null;
    view: string;
  },
) {
  const { userId, email, requestedOrgId, scope, folderId, view } = input;
  const { orgId, orgName, role } = await requireDriveMembership(
    client,
    userId,
    requestedOrgId,
  );

        if (view === "shared") {
          const shares = await listSharedWithMe(client);
          return { status: "shared", orgId, orgName, shares } as const;
        }
        if (view === "recent") {
          const files = await listRecentFiles(client, {
            orgId,
            userId,
            role,
            limit: 60,
          });
          return { status: "recent", orgId, orgName, files } as const;
        }
        if (view === "trash") {
          const files = await listTrashedFiles(client, { orgId, userId, role });
          return { status: "trash", orgId, orgName, files } as const;
        }

        const [folders, files, breadcrumbs, usage, virtualFolders] = await Promise.all([
          listFolders(client, { orgId, scope, userId, parentId: folderId }),
          listFiles(client, { orgId, scope, userId, role, folderId }),
          folderBreadcrumbs(client, { orgId, folderId }),
          loadDriveUsage(client, { orgId, scope, userId }),
          // The Media Library and CAD Vault mirrors only make sense at the top
          // of Team files — they are the team's, and they are not sub-folders
          // of anything.
          scope === "team" && !folderId
            ? loadVirtualFolders(client, { orgId })
            : Promise.resolve([]),
        ]);

        return {
          status: "ready",
          orgId,
          orgName,
          scope,
          folderId,
          breadcrumbs,
          folders,
          files,
          virtualFolders,
          usage,
          viewer: { userId, email: email ?? "", role },
        } satisfies DriveListing;
}

export async function GET(request: Request) {
  try {
    const session = await requireDriveSession();
    const url = new URL(request.url);
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));
    const scopeParam = url.searchParams.get("scope");
    const scope = isDriveScope(scopeParam) ? scopeParam : "team";
    const folderId = readUuid(url.searchParams.get("folderId"));
    const view = readString(url.searchParams.get("view"), 20) ?? "browse";

    const payload = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      (client) => loadDriveListing(client, {
        userId: session.userId,
        email: session.email,
        requestedOrgId,
        scope,
        folderId,
        view,
      }),
    );

    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
