import { isKnownAppPath } from "./app-route-roots";

/** Keep real history (filters and browser scroll restoration) within this app/team. */
export function shellBackUsesHistory(currentHref: string, previousHref: string | null, knownAppSteps = 0): boolean {
  if (!previousHref) return knownAppSteps > 0;
  try {
    const current = new URL(currentHref);
    const previous = new URL(previousHref);
    if (current.origin !== previous.origin || !isKnownAppPath(previous.pathname)
      || ["/", "/signin", "/sign-in", "/onboarding", "/invite", "/register"].includes(previous.pathname)) return false;
    const currentOrg = current.searchParams.get("orgId");
    const previousOrg = previous.searchParams.get("orgId");
    return !(currentOrg && previousOrg && currentOrg !== previousOrg);
  } catch { return false; }
}
