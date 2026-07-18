import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { CHECKLIST_LIBRARY_CATEGORIES, sanitizeItems } from "../../../lib/checklist-library";
import {
  computeChecklistLibraryView,
  createTemplate,
  deleteRun,
  deleteTemplate,
  setTemplateActive,
  startRun,
  toggleRunItem,
  type ChecklistLibraryView,
} from "../../../lib/checklist-library/compute-checklist-library";
import type { ChecklistLibraryCategory, ChecklistLibraryItem } from "../../../lib/checklist-library/types";

export type { ChecklistLibraryView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeChecklistLibraryView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Checklist Library. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ChecklistLibraryView,
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
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-template": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const category = oneOf<ChecklistLibraryCategory>(CHECKLIST_LIBRARY_CATEGORIES, body.category) ?? "pit";
          const items: ChecklistLibraryItem[] = sanitizeItems(body.items);
          if (items.length === 0) throw new Error("At least one checklist item is required");
          await createTemplate(client, {
            orgId,
            userId,
            name,
            category,
            description: trimmedOrNull(body.description, 2000),
            items,
          });
          break;
        }
        case "set-template-active": {
          const templateId = trimmedOrNull(body.templateId, 64);
          if (!templateId) throw new Error("templateId is required");
          await setTemplateActive(client, { orgId, templateId, active: Boolean(body.active) });
          break;
        }
        case "delete-template": {
          const templateId = trimmedOrNull(body.templateId, 64);
          if (!templateId) throw new Error("templateId is required");
          await deleteTemplate(client, { orgId, templateId });
          break;
        }
        case "start-run": {
          const templateId = trimmedOrNull(body.templateId, 64);
          if (!templateId) throw new Error("templateId is required");
          const label = trimmedOrNull(body.label, 200) ?? "Untitled run";
          await startRun(client, { orgId, userId, templateId, label });
          break;
        }
        case "toggle-run-item": {
          const runId = trimmedOrNull(body.runId, 64);
          const itemKey = trimmedOrNull(body.itemKey, 200);
          if (!runId || !itemKey) throw new Error("runId and itemKey are required");
          await toggleRunItem(client, { orgId, runId, itemKey, checked: Boolean(body.checked) });
          break;
        }
        case "delete-run": {
          const runId = trimmedOrNull(body.runId, 64);
          if (!runId) throw new Error("runId is required");
          await deleteRun(client, { orgId, runId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeChecklistLibraryView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checklist Library request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
