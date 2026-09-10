import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  ALUMNI_STATUSES,
  MENTOR_SLOT_STATUSES,
  addMentorSlot,
  addProfile,
  computeAlumniNetworkView,
  deleteMentorSlot,
  deleteProfile,
  updateMentorSlotStatus,
  updateProfile,
  type AlumniNetworkView,
} from "../../../lib/alumni-network/compute-alumni-network";
import type { AlumniStatus, MentorSlotStatus } from "../../../lib/alumni-network/types";

export type { AlumniNetworkView };

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

function yearOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 1950 && n < 2100 ? Math.round(n) : null;
}

function stringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 60))
    .slice(0, max);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeAlumniNetworkView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the alumni network. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies AlumniNetworkView,
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
        case "add-profile": {
          const fullName = trimmedOrNull(body.fullName, 200);
          if (!fullName) throw new Error("fullName is required");
          const status = oneOf<AlumniStatus>(ALUMNI_STATUSES, body.status) ?? "active";
          await addProfile(client, {
            orgId,
            userId,
            fullName,
            graduationYear: yearOrNull(body.graduationYear),
            roleWhileActive: trimmedOrNull(body.roleWhileActive, 200),
            currentOccupation: trimmedOrNull(body.currentOccupation, 200),
            currentLocation: trimmedOrNull(body.currentLocation, 200),
            email: trimmedOrNull(body.email, 200),
            phone: trimmedOrNull(body.phone, 60),
            linkedinUrl: trimmedOrNull(body.linkedinUrl, 300),
            mentorAvailable: body.mentorAvailable === true,
            mentorFocusAreas: stringArray(body.mentorFocusAreas),
            bio: trimmedOrNull(body.bio, 4000),
            status,
          });
          break;
        }
        case "update-profile": {
          const profileId = trimmedOrNull(body.profileId, 64);
          if (!profileId) throw new Error("profileId is required");
          const status = oneOf<AlumniStatus>(ALUMNI_STATUSES, body.status) ?? "active";
          await updateProfile(client, {
            orgId,
            profileId,
            mentorAvailable: body.mentorAvailable === true,
            status,
          });
          break;
        }
        case "delete-profile": {
          const profileId = trimmedOrNull(body.profileId, 64);
          if (!profileId) throw new Error("profileId is required");
          await deleteProfile(client, { orgId, profileId });
          break;
        }
        case "add-mentor-slot": {
          const profileId = trimmedOrNull(body.profileId, 64);
          const topic = trimmedOrNull(body.topic, 200);
          const availableFrom = isoDateOrNull(body.availableFrom);
          if (!profileId) throw new Error("profileId is required");
          if (!topic) throw new Error("topic is required");
          if (!availableFrom) throw new Error("availableFrom (YYYY-MM-DD) is required");
          await addMentorSlot(client, {
            orgId,
            userId,
            profileId,
            topic,
            availableFrom,
            availableTo: isoDateOrNull(body.availableTo),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-mentor-slot-status": {
          const slotId = trimmedOrNull(body.slotId, 64);
          const status = oneOf<MentorSlotStatus>(MENTOR_SLOT_STATUSES, body.status);
          if (!slotId) throw new Error("slotId is required");
          if (!status) throw new Error("status is required");
          await updateMentorSlotStatus(client, { orgId, slotId, status });
          break;
        }
        case "delete-mentor-slot": {
          const slotId = trimmedOrNull(body.slotId, 64);
          if (!slotId) throw new Error("slotId is required");
          await deleteMentorSlot(client, { orgId, slotId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeAlumniNetworkView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Alumni network request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
