import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  deletePlatformOrgOutreach,
  listPlatformOrgOutreach,
  PLATFORM_OUTREACH_STATUSES,
  platformAdminDeniedResponse,
  upsertPlatformOrgOutreach,
  writeAdminAction,
  type PlatformOutreachStatus,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  orgName: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).nullable().optional(),
  contactEmail: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
  status: z.enum(PLATFORM_OUTREACH_STATUSES),
  notes: z.string().trim().max(8000).nullable().optional(),
  nextActionAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  linkedOrgId: z.string().uuid().nullable().optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const rows = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return listPlatformOrgOutreach(client);
    });
    return Response.json({ outreach: rows, statuses: PLATFORM_OUTREACH_STATUSES });
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
      return Response.json({ error: "Invalid outreach payload.", details: body.error.flatten() }, { status: 400 });
    }
    const contactEmail =
      body.data.contactEmail && body.data.contactEmail.trim() ? body.data.contactEmail.trim() : null;
    const row = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      const saved = await upsertPlatformOrgOutreach(client, session.user.id, {
        id: body.data.id,
        orgName: body.data.orgName,
        contactName: body.data.contactName ?? null,
        contactEmail,
        status: body.data.status as PlatformOutreachStatus,
        notes: body.data.notes ?? null,
        nextActionAt: body.data.nextActionAt ?? null,
        linkedOrgId: body.data.linkedOrgId ?? null,
      });
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: body.data.id ? "platform_outreach.updated" : "platform_outreach.created",
        targetOrgId: saved.linkedOrgId ?? undefined,
        payload: { outreachId: saved.id, orgName: saved.orgName, status: saved.status },
      });
      return saved;
    });
    return Response.json({ outreach: row });
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
      await deletePlatformOrgOutreach(client, body.data.id);
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "platform_outreach.deleted",
        payload: { outreachId: body.data.id },
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
