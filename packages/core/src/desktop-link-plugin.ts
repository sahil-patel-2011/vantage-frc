import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/**
 * Server-only session minting for the desktop browser-link flow.
 *
 * The Windows shell (apps/desktop) signs users in through their REAL browser:
 * the desktop posts a sha256 challenge, the user approves the named machine and
 * 8-char code on /desktop-link, and the exchange route
 * (apps/web/app/api/desktop/link/exchange) verifies possession of the original
 * verifier before calling this endpoint via `auth.api`.
 *
 * Two layers keep this off the network:
 *  - `metadata.SERVER_ONLY` — better-call's router skips mounting the endpoint,
 *    so no `/api/auth/desktop-link/session` HTTP path ever exists;
 *  - the handler refuses any invocation that carries a `Request` object.
 *
 * The session itself is created with `internalAdapter.createSession` — the same
 * supported call Better Auth's own device-authorization plugin uses — and the
 * cookie is produced by Better Auth's `setSessionCookie` (signed with the auth
 * secret), so the desktop receives exactly the cookie Better Auth would have
 * set itself; nothing is hand-forged. The minted session is a fresh row for the
 * approving user, independent of the browser session that approved it: either
 * can be revoked without touching the other.
 *
 * The endpoint path deliberately contains "desktop-link" so the session-create
 * hook in index.ts persists auth_method = "desktop_link"
 * (see access-policy.ts `resolveSessionAuthMethod`).
 */
export const desktopLinkSessions = () =>
  ({
    id: "desktop-link",
    endpoints: {
      createDesktopLinkSession: createAuthEndpoint(
        "/desktop-link/session",
        {
          method: "POST",
          body: z.object({ userId: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (ctx.request) {
            // Belt-and-suspenders: SERVER_ONLY already keeps this unrouted.
            throw new APIError("NOT_FOUND", {
              message: "Desktop link sessions are minted server-side only.",
            });
          }
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) {
            throw new APIError("BAD_REQUEST", { message: "Unknown user." });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Desktop session could not be created.",
            });
          }
          await setSessionCookie(ctx, { session, user });
          // The session token travels only inside the signed Set-Cookie header;
          // the JSON body never carries it.
          return ctx.json({
            userId: user.id,
            expiresAt:
              session.expiresAt instanceof Date
                ? session.expiresAt.toISOString()
                : new Date(session.expiresAt).toISOString(),
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
