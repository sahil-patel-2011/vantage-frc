import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  deletePlatformAppSponsor,
  listPlatformAppSponsors,
  PLATFORM_AI_COVERAGE,
  PLATFORM_SPONSOR_OUTREACH,
  PLATFORM_SPONSOR_STATUSES,
  PLATFORM_SPONSOR_TIERS,
  platformAdminDeniedResponse,
  upsertPlatformAppSponsor,
  writeAdminAction,
  type PlatformAiCoverage,
  type PlatformSponsorOutreach,
  type PlatformSponsorStatus,
  type PlatformSponsorTier,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  logoUrl: z.string().trim().url().nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional(),
  tier: z.enum(PLATFORM_SPONSOR_TIERS),
  status: z.enum(PLATFORM_SPONSOR_STATUSES),
  outreachStatus: z.enum(PLATFORM_SPONSOR_OUTREACH),
  aiCoverage: z.enum(PLATFORM_AI_COVERAGE),
  brandTagline: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(8000).nullable().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const sponsors = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return listPlatformAppSponsors(client);
    });
    return Response.json({
      sponsors,
      tiers: PLATFORM_SPONSOR_TIERS,
      statuses: PLATFORM_SPONSOR_STATUSES,
      outreachStatuses: PLATFORM_SPONSOR_OUTREACH,
      aiCoverage: PLATFORM_AI_COVERAGE,
    });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const body = upsertSchema.safeParse(await request.json());
    if (!body.success) {
      return Response.json({ error: "Invalid sponsor payload.", details: body.error.flatten() }, { status: 400 });
    }
    const sponsor = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      const row = await upsertPlatformAppSponsor(client, session.user.id, {
        id: body.data.id,
        name: body.data.name,
        logoUrl: body.data.logoUrl ?? null,
        websiteUrl: body.data.websiteUrl ?? null,
        tier: body.data.tier as PlatformSponsorTier,
        status: body.data.status as PlatformSponsorStatus,
        outreachStatus: body.data.outreachStatus as PlatformSponsorOutreach,
        aiCoverage: body.data.aiCoverage as PlatformAiCoverage,
        brandTagline: body.data.brandTagline ?? null,
        notes: body.data.notes ?? null,
        sortOrder: body.data.sortOrder,
      });
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: body.data.id ? "platform_sponsor.updated" : "platform_sponsor.created",
        payload: { sponsorId: row.id, name: row.name, status: row.status, aiCoverage: row.aiCoverage },
      });
      return row;
    });
    return Response.json({ sponsor });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const body = deleteSchema.safeParse(await request.json());
    if (!body.success) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }
    await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      await deletePlatformAppSponsor(client, body.data.id);
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "platform_sponsor.deleted",
        payload: { sponsorId: body.data.id },
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
