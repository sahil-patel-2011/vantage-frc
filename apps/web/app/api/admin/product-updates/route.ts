import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  emailNotificationsSetupStatus,
  platformAdminDeniedResponse,
  sendProductUpdateEmails,
  writeAdminAction,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const postSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(8000),
});

/** Platform-admin changelog / product update broadcast to opted-in users only. */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    await withRls({ userId: session.user.id }, (client) => assertPlatformAdmin(client));
    return Response.json({ delivery: emailNotificationsSetupStatus() });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");

    const body = postSchema.safeParse(await request.json());
    if (!body.success) {
      return Response.json({ error: "subject and body are required." }, { status: 400 });
    }

    const result = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      const send = await sendProductUpdateEmails(client, body.data);
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "product_updates.broadcast",
        payload: {
          subject: body.data.subject,
          attempted: send.attempted,
          sent: send.sent,
          errors: send.errors,
          delivery: send.delivery,
        },
      });
      return send;
    });

    if (result.delivery === "setup_required") {
      return Response.json(
        {
          status: "setup_required",
          error: result.reason ?? "RESEND_API_KEY and AUTH_EMAIL_FROM are required.",
          ...result,
        },
        { status: 503 },
      );
    }

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
