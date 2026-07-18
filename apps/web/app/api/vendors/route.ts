import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  VENDOR_CATEGORIES,
  computeVendorsView,
  createVendor,
  deleteVendor,
  updateVendor,
  type VendorsView,
} from "../../../lib/vendors/compute-vendors";
import type { VendorCategory } from "../../../lib/vendors/types";

export type { VendorsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function daysOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function ratingOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeVendorsView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load vendors. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies VendorsView,
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
        case "create-vendor": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          await createVendor(client, {
            orgId,
            userId,
            name,
            category: oneOf<VendorCategory>(VENDOR_CATEGORIES, body.category) ?? "other",
            website: trimmedOrNull(body.website, 300),
            contactName: trimmedOrNull(body.contactName, 200),
            contactEmail: trimmedOrNull(body.contactEmail, 200),
            contactPhone: trimmedOrNull(body.contactPhone, 60),
            leadTimeDays: daysOrNull(body.leadTimeDays),
            rating: ratingOrNull(body.rating),
            preferred: body.preferred === true,
            accountNumber: trimmedOrNull(body.accountNumber, 100),
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-vendor": {
          const vendorId = trimmedOrNull(body.vendorId, 64);
          if (!vendorId) throw new Error("vendorId is required");
          const category = body.category === undefined ? undefined : oneOf<VendorCategory>(VENDOR_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          await updateVendor(client, {
            orgId,
            vendorId,
            name: body.name === undefined ? undefined : (trimmedOrNull(body.name, 200) ?? undefined),
            category: category ?? undefined,
            website: body.website === undefined ? undefined : trimmedOrNull(body.website, 300),
            contactName: body.contactName === undefined ? undefined : trimmedOrNull(body.contactName, 200),
            contactEmail: body.contactEmail === undefined ? undefined : trimmedOrNull(body.contactEmail, 200),
            contactPhone: body.contactPhone === undefined ? undefined : trimmedOrNull(body.contactPhone, 60),
            leadTimeDays: body.leadTimeDays === undefined ? undefined : daysOrNull(body.leadTimeDays),
            rating: body.rating === undefined ? undefined : ratingOrNull(body.rating),
            preferred: body.preferred === undefined ? undefined : body.preferred === true,
            accountNumber: body.accountNumber === undefined ? undefined : trimmedOrNull(body.accountNumber, 100),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-vendor": {
          const vendorId = trimmedOrNull(body.vendorId, 64);
          if (!vendorId) throw new Error("vendorId is required");
          await deleteVendor(client, { orgId, vendorId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeVendorsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vendors request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
