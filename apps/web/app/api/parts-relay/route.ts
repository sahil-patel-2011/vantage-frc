import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  PARTS_RELAY_CATEGORIES,
  PARTS_RELAY_CONDITIONS,
  PARTS_RELAY_LISTING_STATUSES,
  PARTS_RELAY_LISTING_TYPES,
  PARTS_RELAY_LOAN_DIRECTIONS,
  computePartsRelayView,
  createListing,
  deleteListing,
  deleteLoan,
  logLoan,
  markLoanLost,
  markLoanReturned,
  updateListingStatus,
  type PartsRelayView,
} from "../../../lib/parts-relay/compute-parts-relay";
import type {
  PartsRelayCategory,
  PartsRelayCondition,
  PartsRelayListingStatus,
  PartsRelayListingType,
  PartsRelayLoanDirection,
} from "../../../lib/parts-relay/types";

export type { PartsRelayView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePartsRelayView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Parts Relay. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies PartsRelayView,
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
        case "create-listing": {
          const partName = trimmedOrNull(body.partName, 200);
          if (!partName) throw new Error("partName is required");
          const listingType = oneOf<PartsRelayListingType>(PARTS_RELAY_LISTING_TYPES, body.listingType);
          if (!listingType) throw new Error("listingType must be 'need' or 'offer'");
          const category = oneOf<PartsRelayCategory>(PARTS_RELAY_CATEGORIES, body.category) ?? "other";
          const condition = oneOf<PartsRelayCondition>(PARTS_RELAY_CONDITIONS, body.condition) ?? "any";
          await createListing(client, {
            orgId,
            userId,
            listingType,
            partName,
            category,
            quantity: positiveInt(body.quantity),
            condition,
            eventKey: trimmedOrNull(body.eventKey, 64),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-listing-status": {
          const listingId = trimmedOrNull(body.listingId, 64);
          if (!listingId) throw new Error("listingId is required");
          const status = oneOf<PartsRelayListingStatus>(PARTS_RELAY_LISTING_STATUSES, body.status);
          if (!status) throw new Error("status is invalid");
          await updateListingStatus(client, { orgId, listingId, status });
          break;
        }
        case "delete-listing": {
          const listingId = trimmedOrNull(body.listingId, 64);
          if (!listingId) throw new Error("listingId is required");
          await deleteListing(client, { orgId, listingId });
          break;
        }
        case "log-loan": {
          const counterpartyTeam = trimmedOrNull(body.counterpartyTeam, 100);
          const partName = trimmedOrNull(body.partName, 200);
          const loanedOn = isoDateOrNull(body.loanedOn);
          if (!counterpartyTeam) throw new Error("counterpartyTeam is required");
          if (!partName) throw new Error("partName is required");
          if (!loanedOn) throw new Error("loanedOn (YYYY-MM-DD) is required");
          const direction = oneOf<PartsRelayLoanDirection>(PARTS_RELAY_LOAN_DIRECTIONS, body.direction);
          if (!direction) throw new Error("direction must be 'lending' or 'borrowing'");
          await logLoan(client, {
            orgId,
            userId,
            listingId: trimmedOrNull(body.listingId, 64),
            direction,
            counterpartyTeam,
            partName,
            quantity: positiveInt(body.quantity),
            eventKey: trimmedOrNull(body.eventKey, 64),
            loanedOn,
            dueBackOn: isoDateOrNull(body.dueBackOn),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "mark-loan-returned": {
          const loanId = trimmedOrNull(body.loanId, 64);
          if (!loanId) throw new Error("loanId is required");
          const returnedOn = isoDateOrNull(body.returnedOn) ?? new Date().toISOString().slice(0, 10);
          await markLoanReturned(client, { orgId, loanId, returnedOn });
          break;
        }
        case "mark-loan-lost": {
          const loanId = trimmedOrNull(body.loanId, 64);
          if (!loanId) throw new Error("loanId is required");
          await markLoanLost(client, { orgId, loanId });
          break;
        }
        case "delete-loan": {
          const loanId = trimmedOrNull(body.loanId, 64);
          if (!loanId) throw new Error("loanId is required");
          await deleteLoan(client, { orgId, loanId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computePartsRelayView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parts Relay request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
