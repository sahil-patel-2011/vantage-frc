import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SPONSOR_WALL_TIERS } from "../../../lib/sponsor-wall";
import {
  addEntry,
  computeSponsorWallView,
  deleteEntry,
  updateEntryPublished,
  upsertSettings,
  type SponsorWallView,
} from "../../../lib/sponsor-wall/compute-sponsor-wall";
import type { SponsorWallTheme, SponsorWallTier } from "../../../lib/sponsor-wall/types";

export type { SponsorWallView };

const SPONSOR_WALL_THEMES: SponsorWallTheme[] = ["light", "dark", "team"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSponsorWallView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Sponsor Wall. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies SponsorWallView,
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
        case "add-entry": {
          const sponsorName = trimmedOrNull(body.sponsorName, 200);
          if (!sponsorName) throw new Error("sponsorName is required");
          const tier = oneOf<SponsorWallTier>(SPONSOR_WALL_TIERS, body.tier) ?? "partner";
          const mediaAssetId = trimmedOrNull(body.mediaAssetId, 64);
          const mediaAsset = mediaAssetId
            ? await client.query<{ url: string }>(
                `SELECT url FROM media_kit_assets WHERE id = $1::uuid AND org_id = $2::uuid`,
                [mediaAssetId, orgId],
              )
            : null;
          if (mediaAssetId && !mediaAsset?.rows[0]) throw new Error("Media asset not found");
          await addEntry(client, {
            orgId,
            userId,
            sponsorName,
            tier,
            logoUrl: mediaAsset?.rows[0]?.url ?? trimmedOrNull(body.logoUrl, 1000),
            websiteUrl: trimmedOrNull(body.websiteUrl, 1000),
            message: trimmedOrNull(body.message, 2000),
            displayOrder: nonNegativeInt(body.displayOrder),
          });
          break;
        }
        case "toggle-publish-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await updateEntryPublished(client, {
            orgId,
            entryId,
            published: boolOrDefault(body.published, true),
          });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteEntry(client, { orgId, entryId });
          break;
        }
        case "update-settings": {
          const headline = trimmedOrNull(body.headline, 200) ?? "Thank You to Our Sponsors";
          const theme = oneOf<SponsorWallTheme>(SPONSOR_WALL_THEMES, body.theme) ?? "light";
          await upsertSettings(client, {
            orgId,
            userId,
            headline,
            subtitle: trimmedOrNull(body.subtitle, 400),
            theme,
            published: boolOrDefault(body.published, false),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSponsorWallView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sponsor Wall request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
