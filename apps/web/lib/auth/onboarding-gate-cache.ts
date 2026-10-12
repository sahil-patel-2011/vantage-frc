/**
 * The proxy's onboarding check, remembered briefly per session.
 *
 * Every page and every API request asked the database whether this person has finished
 * onboarding and is on a team, so one page load (a dozen API calls) made a dozen identical
 * lookups. Only the settled answer, "finished and on a team", is kept, for 30 seconds per
 * session on this server instance; anything else is asked again every time, so finishing
 * onboarding or being approved is seen at once. Row security still checks team access on every
 * query, so a stale "on a team" for a few seconds opens nothing.
 *
 * A failed lookup is retried once after a short pause before the request is turned away: a
 * blip in the connection pool is not "we couldn't check your access".
 */

export type OnboardingGateAnswer = {
  onboardingComplete: boolean;
  workspaceApproved: boolean;
  accessStatus: string;
};

export const GATE_CACHE_TTL_MS = 30_000;
const GATE_CACHE_LIMIT = 1_000;
const RETRY_DELAY_MS = 250;

const cache = new Map<string, { answer: OnboardingGateAnswer; at: number }>();

function remember(key: string, answer: OnboardingGateAnswer, at: number) {
  if (cache.size >= GATE_CACHE_LIMIT) {
    // Oldest first: a Map iterates in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { answer, at });
}

export async function readOnboardingGate(
  sessionKey: string,
  load: () => Promise<OnboardingGateAnswer>,
  options: { now?: () => number; sleep?: (ms: number) => Promise<void>; onFailure?: (error: unknown) => void } = {},
): Promise<OnboardingGateAnswer | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cached = cache.get(sessionKey);
  if (cached && now() - cached.at < GATE_CACHE_TTL_MS) return cached.answer;
  if (cached) cache.delete(sessionKey);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const answer = await load();
      if (answer.onboardingComplete && answer.workspaceApproved) remember(sessionKey, answer, now());
      return answer;
    } catch (error) {
      if (attempt === 1) {
        options.onFailure?.(error);
        return null;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

/** For tests, and for a session that just changed what it may open. */
export function forgetOnboardingGate(sessionKey?: string) {
  if (sessionKey) cache.delete(sessionKey);
  else cache.clear();
}
