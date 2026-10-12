import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../rate-limit";
import { consoleTokenFromRequest, verifyConsoleToken } from "./console-token";
import { readIncident, type OutageIncident } from "./incident";
import { getOutageStore, type OutageStore } from "./status-store";

/**
 * Shared gate for the outage console's API. The signed link is the whole authorization (the
 * database — and with it every session — may be down), so each call verifies it, is rate
 * limited, and only acts on the incident the link was made for.
 */

export type ConsoleContext = {
  store: OutageStore;
  incidentId: string;
  expiresAt: number;
  /** The stored incident, or null when this server has no record of it (memory store). */
  incident: OutageIncident | null;
};

const NO_STORE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export function consoleJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

const readLimiter = createRateLimiter({ limit: 30, windowMs: 60_000, namespace: "outage-console-read" });
const writeLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "outage-console-write" });

const TOKEN_MESSAGES: Record<string, string> = {
  expired: "This link has expired. The next alert email brings a fresh one.",
  secret_missing: "The console can't check links: BETTER_AUTH_SECRET isn't set.",
};

export async function openConsole(
  request: Request,
  options: { body?: { token?: unknown } | null; write?: boolean } = {},
): Promise<{ ok: true; context: ConsoleContext } | { ok: false; response: Response }> {
  const verified = verifyConsoleToken(consoleTokenFromRequest(request, options.body));
  if (!verified.ok) {
    return {
      ok: false,
      response: consoleJson(
        { error: TOKEN_MESSAGES[verified.reason] ?? "This link isn't valid.", code: `link_${verified.reason}` },
        verified.reason === "secret_missing" ? 503 : 401,
      ),
    };
  }
  const limiter = options.write ? writeLimiter : readLimiter;
  const allowed = await limiter
    .allow(options.write ? verified.incidentId : anonymizeIp(clientIp(request)))
    .catch(() => true);
  if (!allowed) return { ok: false, response: rateLimitedResponse("Too many tries. Wait a minute and try again.") };

  const store = getOutageStore();
  const incident = await readIncident(store).catch(() => null);
  // The shared store keeps only the latest incident, so a different id means this link is for
  // an older one. (Without a shared store each server names its own incident; nothing to compare.)
  if (options.write && store.kind === "upstash" && incident && incident.id !== verified.incidentId) {
    return {
      ok: false,
      response: consoleJson(
        { error: "A newer outage is open. Use the link in the most recent alert email.", code: "newer_incident" },
        409,
      ),
    };
  }
  return {
    ok: true,
    context: {
      store,
      incidentId: verified.incidentId,
      expiresAt: verified.expiresAt,
      incident: incident?.id === verified.incidentId ? incident : null,
    },
  };
}
