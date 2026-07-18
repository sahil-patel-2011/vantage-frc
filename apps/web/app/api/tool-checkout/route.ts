import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  TOOL_CATEGORIES,
  addTool,
  checkoutTool,
  computeToolCheckoutView,
  retireTool,
  returnTool,
  type ToolCheckoutView,
} from "../../../lib/tool-checkout/compute-tool-checkout";
import type { ToolCategory } from "../../../lib/tool-checkout/types";

export type { ToolCheckoutView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeToolCheckoutView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load tool checkout. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ToolCheckoutView,
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
        case "add-tool": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const category = oneOf<ToolCategory>(TOOL_CATEGORIES, body.category) ?? "other";
          await addTool(client, {
            orgId,
            userId,
            name,
            category,
            assetTag: trimmedOrNull(body.assetTag, 100),
            location: trimmedOrNull(body.location, 200),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "retire-tool": {
          const toolId = trimmedOrNull(body.toolId, 64);
          if (!toolId) throw new Error("toolId is required");
          await retireTool(client, { orgId, toolId });
          break;
        }
        case "checkout-tool": {
          const toolId = trimmedOrNull(body.toolId, 64);
          const borrowerName = trimmedOrNull(body.borrowerName, 200);
          if (!toolId) throw new Error("toolId is required");
          if (!borrowerName) throw new Error("borrowerName is required");
          await checkoutTool(client, {
            orgId,
            userId,
            toolId,
            borrowerName,
            dueAt: isoTimestampOrNull(body.dueAt),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "return-tool": {
          const loanId = trimmedOrNull(body.loanId, 64);
          if (!loanId) throw new Error("loanId is required");
          await returnTool(client, { orgId, loanId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeToolCheckoutView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool checkout request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
