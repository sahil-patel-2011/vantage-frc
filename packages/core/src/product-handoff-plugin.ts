import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/**
 * Server-only session minting for the Vantage ↔ Scouting handoff.
 *
 * The two products are one deployment on two hostnames. A browser cannot share
 * a cookie between two *.vercel.app hosts (Public Suffix List), so the
 * destination host redeems a one-time handoff token (migration 0670) and then
 * calls this endpoint through `auth.api` to set its own session cookie.
 *
 * Same guarantees as desktop-link-plugin.ts, which this mirrors:
 *  - `metadata.SERVER_ONLY` keeps the endpoint off the HTTP router, and the
 *    handler refuses any call that carries a Request;
 *  - the session is a real Better Auth session (`internalAdapter.createSession`)
 *    and the cookie comes from `setSessionCookie`, signed with the auth secret.
 *
 * The new session inherits the source session's sign-in method and
 * second-factor time, so a team that allows only Google sign-in, or requires
 * the email code, sees exactly the same standing on both hosts.
 */
export const productHandoffSessions = () =>
  ({
    id: "product-handoff",
    endpoints: {
      createProductHandoffSession: createAuthEndpoint(
        "/product-handoff/session",
        {
          method: "POST",
          body: z.object({
            userId: z.string().min(1),
            authMethod: z.string().max(40).optional(),
            email2faVerifiedAt: z.string().datetime().nullable().optional(),
          }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (ctx.request) {
            throw new APIError("NOT_FOUND", { message: "Handoff sessions are minted server-side only." });
          }
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: "Unknown user." });
          const created = await ctx.context.internalAdapter.createSession(user.id);
          if (!created) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Session could not be created." });
          }
          const carried: Record<string, unknown> = {};
          if (ctx.body.authMethod) carried.authMethod = ctx.body.authMethod;
          if (ctx.body.email2faVerifiedAt) carried.email2faVerifiedAt = new Date(ctx.body.email2faVerifiedAt);
          const session =
            Object.keys(carried).length > 0
              ? ((await ctx.context.internalAdapter.updateSession(created.token, carried)) ?? created)
              : created;
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
