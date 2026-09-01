import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeOnboardingBuddyView,
  createPairing,
  deletePairing,
  setPairingStatus,
  togglePlanItem,
  type OnboardingBuddyView,
} from "../../../lib/onboarding-buddy/compute-onboarding-buddy";
import { onboardingBuddySetupSteps } from "../../../lib/onboarding-buddy/onboarding-buddy-related";
import {
  OnboardingBuddyError,
  parseCreatePairingInput,
} from "../../../lib/onboarding-buddy/roster";
import type { OnboardingBuddyPairingStatus } from "../../../lib/onboarding-buddy/types";

export type { OnboardingBuddyView };

const PAIRING_STATUSES: OnboardingBuddyPairingStatus[] = ["active", "completed", "cancelled"];

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeOnboardingBuddyView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Onboarding Buddy. Select a workspace and confirm database access.",
        steps: onboardingBuddySetupSteps(null),
        orgId: null,
      } satisfies OnboardingBuddyView,
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

  let createInput: ReturnType<typeof parseCreatePairingInput> | null = null;
  if (action === "create-pairing") {
    try {
      createInput = parseCreatePairingInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid pairing";
      const status = error instanceof OnboardingBuddyError ? error.status : 400;
      return Response.json({ error: message }, { status });
    }
  }

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-pairing": {
          await createPairing(client, {
            orgId,
            userId,
            newMemberId: createInput!.newMemberId,
            buddyId: createInput!.buddyId,
            notes: createInput!.notes,
          });
          break;
        }
        case "toggle-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await togglePlanItem(client, { orgId, itemId, done: Boolean(body.done) });
          break;
        }
        case "set-status": {
          const pairingId = trimmedOrNull(body.pairingId, 64);
          const status = oneOf<OnboardingBuddyPairingStatus>(PAIRING_STATUSES, body.status);
          if (!pairingId) throw new Error("pairingId is required");
          if (!status) throw new Error("status must be one of active, completed, cancelled");
          await setPairingStatus(client, { orgId, pairingId, status });
          break;
        }
        case "delete-pairing": {
          const pairingId = trimmedOrNull(body.pairingId, 64);
          if (!pairingId) throw new Error("pairingId is required");
          await deletePairing(client, { orgId, pairingId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeOnboardingBuddyView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof OnboardingBuddyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Onboarding Buddy request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
