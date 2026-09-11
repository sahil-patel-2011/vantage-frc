import { withRls } from "@vantage/db";
import { resolveRequestActor } from "../../../lib/auth/request-actor";
import {
  computeHoursSelfViewView,
  clockSelfIn,
  clockSelfOut,
  deleteKioskSession,
  hoursSelfViewChooseTeamView,
  recordBiometricConsent,
  registerKioskSession,
  setKioskLock,
  type HoursSelfViewView,
} from "../../../lib/hours-self-view/compute-hours-self-view";
import type { BiometricConsentStatus, HourLogKind } from "../../../lib/hours-self-view/types";

export type { HoursSelfViewView };

const CONSENT_STATUSES: BiometricConsentStatus[] = ["pending", "granted", "denied"];
const HOUR_KINDS: HourLogKind[] = ["build", "meeting", "outreach", "competition", "other"];
type HoursSelfViewAction =
  | "clock_in"
  | "clock_out"
  | "record-biometric-consent"
  | "register-kiosk-session"
  | "set-kiosk-lock"
  | "delete-kiosk-session";

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

function parseHoursSelfViewAction(value: string): HoursSelfViewAction | null {
  switch (value) {
    case "clock_in":
    case "clock_out":
    case "record-biometric-consent":
    case "register-kiosk-session":
    case "set-kiosk-lock":
    case "delete-kiosk-session":
      return value;
    default:
      return null;
  }
}

export async function GET(request: Request) {
  const actor = await resolveRequestActor();
  if (!actor) {
    return Response.json(hoursSelfViewChooseTeamView("Choose your team to view your own hours."), {
      status: 200,
    });
  }

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: actor.userId }, (client) =>
      computeHoursSelfViewView(client, { userId: actor.userId, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(hoursSelfViewChooseTeamView("Could not load your hours. Choose your team."), {
      status: 200,
    });
  }
}

export async function POST(request: Request) {
  const actor = await resolveRequestActor();
  if (!actor) {
    return Response.json(hoursSelfViewChooseTeamView("Choose your team before clocking in."), {
      status: 200,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = actor.userId;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      const parsed = parseHoursSelfViewAction(action);
      if (!parsed) throw new Error("Unknown action");

      switch (parsed) {
        case "clock_in": {
          const kind = oneOf<HourLogKind>(HOUR_KINDS, body.kind) ?? "build";
          await clockSelfIn(client, { orgId, userId, kind });
          break;
        }
        case "clock_out": {
          await clockSelfOut(client, { orgId, userId });
          break;
        }
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
        default: {
          const _never: never = parsed;
          throw new Error(`Unhandled hours action: ${_never}`);
        }
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
