import { withOrgHref } from "../nav/product-nav";

/** Keep team context as setup moves between personal and shared connections. */
export function aiConnectionHref(orgId?: string | null): string {
  return withOrgHref("/ai/connect", orgId);
}
