import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addResourceLink,
  computeLibraryView,
  createFileResource,
  createFolder,
  createLinkResource,
  deleteFolder,
  deleteResource,
  deleteResourceLink,
  setResourceSharing,
  updateFolder,
  updateResource,
} from "../../../lib/library/compute-library";
import type { LibraryView } from "../../../lib/library/types";
import {
  normalizeGrantUserIds,
  normalizeTags,
  normalizeVisibility,
  trimmedOrNull,
  validateFileMetadata,
  validateLinkInput,
} from "../../../lib/library/validation";

export type { LibraryView };

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeLibraryView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the team library. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies LibraryView,
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
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-folder": {
          const name = trimmedOrNull(body.name, 120);
          if (!name) throw new Error("Folder name is required");
          const visibility = normalizeVisibility(body.visibility);
          const folderId = await createFolder(client, {
            orgId,
            userId,
            name,
            parentId: trimmedOrNull(body.parentId, 64),
            visibility,
            grantUserIds:
              visibility === "restricted" ? normalizeGrantUserIds(body.grantUserIds) : [],
          });
          return { folderId };
        }
        case "update-folder": {
          const folderId = trimmedOrNull(body.folderId, 64);
          if (!folderId) throw new Error("folderId is required");
          const updated = await updateFolder(client, {
            orgId,
            userId,
            folderId,
            name: trimmedOrNull(body.name, 120) ?? undefined,
            parentId: body.parentId === undefined ? undefined : trimmedOrNull(body.parentId, 64),
            visibility:
              body.visibility === undefined ? undefined : normalizeVisibility(body.visibility),
            grantUserIds:
              body.grantUserIds === undefined ? undefined : normalizeGrantUserIds(body.grantUserIds),
          });
          if (!updated) throw new Error("Folder not found or you cannot edit it");
          return { ok: true };
        }
        case "delete-folder": {
          const folderId = trimmedOrNull(body.folderId, 64);
          if (!folderId) throw new Error("folderId is required");
          const deleted = await deleteFolder(client, { orgId, folderId });
          if (!deleted) throw new Error("Folder not found or you cannot delete it");
          return { ok: true };
        }
        case "create-file": {
          const validated = validateFileMetadata(body);
          if (!validated.ok) throw new Error(validated.error);
          const created = await createFileResource(client, {
            orgId,
            userId,
            metadata: validated.value,
          });
          return {
            resourceId: created.resourceId,
            duplicate: created.duplicate,
            uploadUrl: created.duplicate
              ? null
              : `/api/library/items/${created.resourceId}?orgId=${encodeURIComponent(orgId)}`,
          };
        }
        case "create-link": {
          const validated = validateLinkInput(body);
          if (!validated.ok) throw new Error(validated.error);
          const visibility = normalizeVisibility(body.visibility);
          const resourceId = await createLinkResource(client, {
            orgId,
            userId,
            title: validated.value.title,
            url: validated.value.url,
            notes: validated.value.notes,
            folderId: trimmedOrNull(body.folderId, 64),
            tags: normalizeTags(body.tags),
            visibility,
            grantUserIds:
              visibility === "restricted" ? normalizeGrantUserIds(body.grantUserIds) : [],
          });
          return { resourceId };
        }
        case "update-resource": {
          const resourceId = trimmedOrNull(body.resourceId, 64);
          if (!resourceId) throw new Error("resourceId is required");
          const updated = await updateResource(client, {
            orgId,
            resourceId,
            title: trimmedOrNull(body.title, 200) ?? undefined,
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes, 4000),
            tags: body.tags === undefined ? undefined : normalizeTags(body.tags),
            folderId: body.folderId === undefined ? undefined : trimmedOrNull(body.folderId, 64),
          });
          if (!updated) throw new Error("Resource not found or you cannot edit it");
          return { ok: true };
        }
        case "set-sharing": {
          const resourceId = trimmedOrNull(body.resourceId, 64);
          if (!resourceId) throw new Error("resourceId is required");
          const visibility = normalizeVisibility(body.visibility);
          const updated = await setResourceSharing(client, {
            orgId,
            userId,
            resourceId,
            visibility,
            grantUserIds:
              visibility === "restricted" ? normalizeGrantUserIds(body.grantUserIds) : [],
          });
          if (!updated) throw new Error("Resource not found or you cannot edit it");
          return { ok: true };
        }
        case "delete-resource": {
          const resourceId = trimmedOrNull(body.resourceId, 64);
          if (!resourceId) throw new Error("resourceId is required");
          const deleted = await deleteResource(client, { orgId, resourceId });
          if (!deleted) throw new Error("Resource not found or you cannot delete it");
          return { ok: true };
        }
        case "add-link": {
          const resourceId = trimmedOrNull(body.resourceId, 64);
          if (!resourceId) throw new Error("resourceId is required");
          const validated = validateLinkInput(body);
          if (!validated.ok) throw new Error(validated.error);
          const linkId = await addResourceLink(client, {
            orgId,
            userId,
            resourceId,
            title: validated.value.title,
            url: validated.value.url,
            notes: validated.value.notes,
          });
          return { linkId };
        }
        case "remove-link": {
          const linkId = trimmedOrNull(body.linkId, 64);
          if (!linkId) throw new Error("linkId is required");
          const deleted = await deleteResourceLink(client, { orgId, linkId });
          if (!deleted) throw new Error("Link not found or you cannot remove it");
          return { ok: true };
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Library request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
