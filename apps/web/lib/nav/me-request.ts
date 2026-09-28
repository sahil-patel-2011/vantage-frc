/**
 * GHA Playwright has no Postgres. A hung `/api/me` left hubs on Opening your
 * team, and standalone pages (Inventory, Logistics, Print Farm, Files) stayed
 * on their loading cards until Playwright timed out.
 *
 * It lives here rather than in `resolve-org`, which re-exports it for the
 * modules that already import it from there: `resolve-org` needs `requestMe`,
 * so the dependency has to run this way to stay acyclic.
 */
export const FEATURE_API_TIMEOUT_MS = 8_000;

/**
 * One `/api/me` per page load instead of seven.
 *
 * Five places need something from `/api/me` — the active org, the hub access
 * list, the narration audience, the paid-session check, the command palette —
 * and each one fetched it itself. On the scouting page that was seven requests
 * for one answer, before a scout at a competition has touched anything, on
 * whatever venue wifi they are on.
 *
 * Callers still read the fields they care about; they just share the request.
 *
 * `FRESH_MS` is deliberately short. It exists to collapse a mount storm —
 * components mounting together, and React's development double-effect, which
 * remounts rather than overlapping, so coalescing in-flight requests alone
 * would not catch it. It is not a session cache: anything that changes who you
 * are or which team you are in navigates, and two seconds does not outlive
 * that.
 */
const FRESH_MS = 2_000;

export type MeResult = {
  ok: boolean;
  /** 0 when the request never got a reply (offline, timeout, abort). */
  status: number;
  /** Parsed body on a 2xx, null otherwise. */
  data: unknown;
};

const inFlight = new Map<string, Promise<MeResult>>();
const settled = new Map<string, { at: number; result: MeResult }>();
let generation = 0;

/** Undefined follows the current page; explicit null requests the account default. */
export function sessionOrgId(orgId?: string | null): string {
  if (orgId !== undefined) return orgId?.trim() ?? "";
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
}

/** Drops the shared answer. For tests, and for a sign-out or team switch. */
export function forgetMe(): void {
  generation++;
  inFlight.clear();
  settled.clear();
}

/** One answer per selected team: a team switch never reuses another team's permissions. */
export async function requestMe(orgId?: string | null): Promise<MeResult> {
  const scope = sessionOrgId(orgId);
  const cached = settled.get(scope);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.result;
  const pending = inFlight.get(scope);
  if (pending) return pending;
  const started = generation;

  const request = (async () => {
    let result: MeResult;
    try {
      const response = await fetch(scope ? `/api/me?orgId=${encodeURIComponent(scope)}` : "/api/me", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      result = { ok: response.ok, status: response.status, data };
    } catch {
      result = { ok: false, status: 0, data: null };
    }
    // Recorded before the promise resolves, so a caller arriving in the gap
    // between this request finishing and its awaiters running gets the answer
    // rather than starting a second request.
    if (generation === started) {
      settled.set(scope, { at: Date.now(), result });
      inFlight.delete(scope);
    }
    return result;
  })();

  inFlight.set(scope, request);
  return request;
}
