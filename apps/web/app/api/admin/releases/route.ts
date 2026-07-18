import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  createProductRelease,
  getProductRelease,
  listProductReleases,
  platformAdminDeniedResponse,
  productReleaseDeliverySetupStatus,
  publishProductRelease,
  updateProductRelease,
  writeAdminAction,
  PRODUCT_RELEASE_AUDIENCES,
  PRODUCT_RELEASE_STATUSES,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const audienceSchema = z.enum(PRODUCT_RELEASE_AUDIENCES);
const statusSchema = z.enum(PRODUCT_RELEASE_STATUSES);

const upsertSchema = z.object({
  slug: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  versionLabel: z.string().trim().max(40).nullable().optional(),
  notesMarkdown: z.string().trim().min(1).max(50_000),
  audienceType: audienceSchema,
  audiencePlanCodes: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  minPlan: z.string().trim().max(64).nullable().optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  status: statusSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
});

const patchSchema = upsertSchema.partial().extend({
  id: z.string().uuid(),
  publish: z.boolean().optional(),
  notify: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const releases = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return listProductReleases(client);
    });
    return Response.json({
      releases,
      delivery: productReleaseDeliverySetupStatus(),
      audiences: PRODUCT_RELEASE_AUDIENCES,
      statuses: PRODUCT_RELEASE_STATUSES,
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
      return Response.json({ error: "Invalid release payload.", details: body.error.flatten() }, { status: 400 });
    }

    const result = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      const release = await createProductRelease(client, body.data, session.user.id);
      let notify = undefined;
      if (release.status === "published") {
        const published = await publishProductRelease(client, release.id, session.user.id, {
          notify: true,
        });
        notify = published.notify;
      }
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "product_releases.create",
        payload: {
          releaseId: release.id,
          slug: release.slug,
          status: release.status,
          audienceType: release.audienceType,
          notify,
        },
      });
      return { release: notify ? (await getProductRelease(client, release.id))! : release, notify };
    });

    if (result.notify?.delivery === "setup_required") {
      return Response.json(
        {
          status: "setup_required",
          error: result.notify.reason ?? "RESEND_API_KEY and AUTH_EMAIL_FROM are required.",
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

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return Response.json({ error: "Invalid release patch.", details: body.error.flatten() }, { status: 400 });
    }

    const { id, publish, notify: notifyOpt, ...patch } = body.data;

    const result = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });

      let release = Object.keys(patch).length
        ? await updateProductRelease(client, id, patch, session.user.id)
        : await getProductRelease(client, id);
      if (!release) throw new Error("Release not found");

      let notify = undefined;
      if (publish || patch.status === "published") {
        const published = await publishProductRelease(client, id, session.user.id, {
          notify: notifyOpt !== false,
        });
        release = published.release;
        notify = published.notify;
      }

      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: publish ? "product_releases.publish" : "product_releases.update",
        payload: {
          releaseId: id,
          slug: release.slug,
          status: release.status,
          notify,
        },
      });
      return { release, notify };
    });

    if (result.notify?.delivery === "setup_required") {
      return Response.json(
        {
          status: "setup_required",
          error: result.notify.reason ?? "RESEND_API_KEY and AUTH_EMAIL_FROM are required.",
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
