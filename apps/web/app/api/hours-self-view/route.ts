import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeHoursSelfViewView,
  deleteKioskSession,
  recordBiometricConsent,
  registerKioskSession,
  setKioskLock,
  type HoursSelfViewView,
} from "../../../lib/hours-self-view/compute-hours-self-view";
import type { BiometricConsentStatus } from "../../../lib/hours-self-view/types";

export type { HoursSelfViewView };

const CONSENT_STATUSES: BiometricConsentStatus[] = ["pending", "granted", "denied"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeHoursSelfViewView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load your hours. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies HoursSelfViewView,
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
        case "record-biometric-consent": {
          const subjectUserId = trimmedOrNull(body.subjectUserId, 64) ?? userId;
          const status = oneOf<BiometricConsentStatus>(CONSENT_STATUSES, body.status) ?? "pending";
          await recordBiometricConsent(client, {
            orgId,
            userId,
            subjectUserId,
            isMinor: toBool(body.isMinor, true),
            status,
            guardianName: trimmedOrNull(body.guardianName, 200),
          });
          break;
        }
        case "register-kiosk-session": {
          const deviceLabel = trimmedOrNull(body.deviceLabel, 120);
          if (!deviceLabel) throw new Error("deviceLabel is required");
          await registerKioskSession(client, { orgId, userId, deviceLabel });
          break;
        }
        case "set-kiosk-lock": {
          const kioskId = trimmedOrNull(body.kioskId, 64);
          if (!kioskId) throw new Error("kioskId is required");
          await setKioskLock(client, { orgId, kioskId, isLocked: toBool(body.isLocked, true) });
          break;
        }
        case "delete-kiosk-session": {
          const kioskId = trimmedOrNull(body.kioskId, 64);
          if (!kioskId) throw new Error("kioskId is required");
          await deleteKioskSession(client, { orgId, kioskId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeHoursSelfViewView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hours self-view request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
