import { withRls } from "@vantage/db";
import { after } from "next/server";
import {
  AdminRouteError,
  NO_STORE,
  UUID_PATTERN,
  adminErrorResponse,
  asPlatformAdmin,
  readJsonBody,
} from "../../../../lib/admin/admin-route";
import {
  giftRefusal,
  grantGift,
  loadAiCreditOverview,
  loadKeyPool,
  parseGiftInput,
  revokeGift,
} from "../../../../lib/admin/ai-credits";
import { emailGiftNotice } from "../../../../lib/ai-credit/gift-mail";
import { CREDIT_GIFT_FAMILIES } from "@vantage/billing";

/**
 * AI credit gifts, for platform admins: every gift with its spend (GET, `?orgId=` for one team),
 * gift a team credit (POST), end a gift early (DELETE). Giving and ending need a sign-in from the
 * last 24 hours. A gift is paid from the operator's key pool (/api/admin/ai-keys); keys are named
 * here by label and env var name, never sent.
 */

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (orgId && !UUID_PATTERN.test(orgId)) throw new AdminRouteError(400, "Choose a team.");
    const overview = await asPlatformAdmin((client) => loadAiCreditOverview(client, { orgId: orgId ?? undefined }));
    return Response.json(overview, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "AI credit didn't load. Try again.", giftRefusal);
  }
}

/** `{ orgId, family?, amountUsd?, expiresAt?, note? }`; $10 of Claude by default. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const { giftId, input, adminId } = await asPlatformAdmin(
      async (client, session) => {
        const input = parseGiftInput(body, await loadKeyPool(client));
        return { giftId: await grantGift(client, input), input, adminId: session.user.id };
      },
      { fresh: true },
    );
    // The inbox notice is already written; email follows after the response, when mail is set up.
    after(async () => {
      await withRls({ userId: adminId }, (client) =>
        emailGiftNotice(client, {
          orgId: input.orgId,
          kind: "granted",
          gift: {
            amountUsd: input.amountUsd,
            usedUsd: 0,
            familyLabel: CREDIT_GIFT_FAMILIES[input.family].label,
            note: input.note,
            expiresAt: input.expiresAt,
          },
        }),
      ).catch(() => 0);
    });
    return Response.json({ giftId, amountUsd: input.amountUsd, family: input.family }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The credit wasn't given. Try again in a minute.", giftRefusal);
  }
}

/** `{ giftId }`: what was spent stays on the record; Ask AI stops drawing on it at once. */
export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody(request);
    const giftId = typeof body.giftId === "string" ? body.giftId.trim() : "";
    if (!UUID_PATTERN.test(giftId)) throw new AdminRouteError(400, "Choose a gift from the list.");
    await asPlatformAdmin((client) => revokeGift(client, giftId), { fresh: true });
    return Response.json({ revoked: giftId }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The gift is still active. Try again in a minute.", giftRefusal);
  }
}
