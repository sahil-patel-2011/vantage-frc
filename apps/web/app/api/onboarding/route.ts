import { auth, completeOnboarding, getOnboardingState, saveOnboardingProgress } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../lib/security/request";

const mutationLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "onboarding" });

async function session() {
  return auth.api.getSession({ headers: await headers() });
}

const focus = z.enum(["competition", "build", "business", "leadership"]);
const role = z.enum(["student", "mentor", "coach", "parent", "other"]);
const teamAffiliation = z.enum(["private_school", "public_school", "community"]);

const crew = z.enum(["scout", "driver", "operator", "mechanical", "electrical", "programming", "cad", "pit", "business", "other"]);
const teamNumber = z.number().int().min(1).max(99999).nullable();

const completeSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say", "other"]),
  preferredTeamNumber: teamNumber,
  teamRole: role.nullable().optional(),
  crewRole: crew.nullable().optional(),
  roleDescription: z.string().trim().max(280).nullable().optional(),
  primaryFocus: focus,
  displayName: z.string().trim().max(80).nullable().optional(),
  themePreference: z.enum(["light", "dark"]).optional(),
  city: z.string().trim().max(120).nullable().optional(),
  stateProv: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  /** Two separate consents; the server refuses the request unless BOTH are sent. */
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  teamAffiliation: teamAffiliation.nullable().optional(),
  schoolFunded: z.boolean().optional(),
  outsideGrants: z.boolean().optional(),
  sponsorsAllowed: z.boolean().optional(),
}).strict();

const draftSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("profile"),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say", "other"]),
  }).strict(),
  z.object({
    step: z.literal("team"),
    preferredTeamNumber: teamNumber,
    teamRole: role.nullable().optional(),
    crewRole: crew.nullable().optional(),
    roleDescription: z.string().trim().max(280).nullable().optional(),
    primaryFocus: focus,
  }).strict(),
  z.object({
    step: z.literal("preferences"),
    displayName: z.string().trim().max(80).nullable().optional(),
    themePreference: z.enum(["light", "dark"]).optional(),
  }).strict(),
]);

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  const current = await session();
  if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const state = await withRls({ userId: current.user.id }, (client) =>
      getOnboardingState(client, current.user.id),
    );
    return privateJson(state);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load onboarding state." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const current = await session();
  if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const key = `${current.user.id}:${anonymizeIp(clientIp(request))}`;
    if (!(await mutationLimiter.allow(key))) return rateLimitedResponse("Too many onboarding changes. Wait a moment and try again.");
    const body = await parseSecureJson(request, completeSchema);
    const state = await withRls({ userId: current.user.id }, (client) =>
      completeOnboarding(client, current.user.id, body),
    );
    return privateJson({ ok: true, ...state });
  } catch (error) {
    return securityErrorResponse(error, "Could not complete onboarding.");
  }
}

export async function PATCH(request: Request) {
  const current = await session();
  if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const key = `${current.user.id}:${anonymizeIp(clientIp(request))}`;
    if (!(await mutationLimiter.allow(key))) return rateLimitedResponse("Too many onboarding changes. Wait a moment and try again.");
    const body = await parseSecureJson(request, draftSchema);
    const state = await withRls({ userId: current.user.id }, (client) =>
      saveOnboardingProgress(client, current.user.id, body),
    );
    return privateJson({ ok: true, ...state });
  } catch (error) {
    return securityErrorResponse(error, "Could not save onboarding progress.");
  }
}
