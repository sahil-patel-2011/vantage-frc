import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeSponsorTierCalculatorView,
  currentSeasonYear,
  deleteTierDefinition,
  setBenefitFulfillment,
  upsertTierDefinition,
  type SponsorTierCalculatorView,
} from "../../../lib/sponsor-tier-calculator/compute-sponsor-tier-calculator";

export type { SponsorTierCalculatorView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function intOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function stringArray(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 200);
    if (trimmed) out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSponsorTierCalculatorView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the sponsor tier calculator. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SponsorTierCalculatorView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "save-tier": {
          const name = trimmedOrNull(body.name, 100);
          if (!name) throw new Error("name is required");
          await upsertTierDefinition(client, {
            orgId,
            userId,
            name,
            minAmountUsd: nonNegativeNumber(body.minAmountUsd),
            benefits: stringArray(body.benefits),
            sortOrder: intOrZero(body.sortOrder),
          });
          break;
        }
        case "delete-tier": {
          const tierId = trimmedOrNull(body.tierId, 64);
          if (!tierId) throw new Error("tierId is required");
          await deleteTierDefinition(client, { orgId, tierId });
          break;
        }
        case "set-fulfillment": {
          const sponsorId = trimmedOrNull(body.sponsorId, 64);
          const benefit = trimmedOrNull(body.benefit, 200);
          if (!sponsorId) throw new Error("sponsorId is required");
          if (!benefit) throw new Error("benefit is required");
          await setBenefitFulfillment(client, {
            orgId,
            userId,
            sponsorId,
            seasonYear,
            benefit,
            fulfilled: Boolean(body.fulfilled),
            notes: trimmedOrNull(body.notes, 1000),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSponsorTierCalculatorView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sponsor tier calculator request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
