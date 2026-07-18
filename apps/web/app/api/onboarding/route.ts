import { auth, completeOnboarding, getOnboardingState } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

async function session() {
  return auth.api.getSession({ headers: await headers() });
}

const completeSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say", "other"]),
  preferredTeamNumber: z.number().int(),
  teamRole: z.enum(["student", "mentor", "coach", "parent", "other"]).nullable().optional(),
  displayName: z.string().nullable().optional(),
  themePreference: z.enum(["light", "dark"]).optional(),
  city: z.string().nullable().optional(),
  stateProv: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  termsAccepted: z.literal(true),
});

export async function GET() {
  const current = await session();
  if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const state = await withRls({ userId: current.user.id }, (client) =>
      getOnboardingState(client, current.user.id),
    );
    return Response.json(state);
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
  const body = completeSchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "Invalid onboarding payload." }, { status: 400 });
  }
  try {
    const state = await withRls({ userId: current.user.id }, (client) =>
      completeOnboarding(client, current.user.id, body.data),
    );
    return Response.json({ ok: true, ...state });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not complete onboarding." },
      { status: 400 },
    );
  }
}
