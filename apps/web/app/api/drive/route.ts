// Vantage Drive listing: the folder tree and files for one scope, plus the
// real per-location byte totals. Session-authenticated and org-scoped through
// withRls — the RLS policies in 0641 decide what comes back, and the personal
// scope is invisible to everyone but its owner including owners and admins.

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
import type { DriveListing } from "../../../lib/drive/types";

export const dynamic = "force-dynamic";

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
      async (client) => {
        const { orgId, orgName, role } = await requireDriveMembership(
          client,
          session.userId,
          requestedOrgId,
        );

        if (view === "shared") {
          const shares = await listSharedWithMe(client);
          return { status: "shared", orgId, orgName, shares } as const;
        }
        if (view === "recent") {
          const files = await listRecentFiles(client, {
            orgId,
            userId: session.userId,
            role,
            limit: 60,
          });
          return { status: "recent", orgId, orgName, files } as const;
        }
        if (view === "trash") {
          const files = await listTrashedFiles(client, { orgId, userId: session.userId, role });
          return { status: "trash", orgId, orgName, files } as const;
        }

        const [folders, files, breadcrumbs, usage, virtualFolders] = await Promise.all([
          listFolders(client, { orgId, scope, userId: session.userId, parentId: folderId }),
          listFiles(client, { orgId, scope, userId: session.userId, role, folderId }),
          folderBreadcrumbs(client, { orgId, folderId }),
          loadDriveUsage(client, { orgId, scope, userId: session.userId }),
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
          viewer: { userId: session.userId, email: session.email, role },
        } satisfies DriveListing;
      },
    );

    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
