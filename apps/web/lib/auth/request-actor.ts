import { auth } from "@vantage/core";
import { headers } from "next/headers";
import {
  isE2eFixtureCookie,
  resolveProductActor,
  type ProductActor,
} from "./product-actor";

export { isE2eFixtureCookie, type ProductActor };

/** Better Auth session, or the local E2E fixture identity on vantage_ci. */
export async function resolveRequestActor(): Promise<ProductActor | null> {
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: headerList });
  } catch {
    session = null;
  }
  return resolveProductActor({
    session: session
      ? {
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
          sessionId: session.session.id,
          authMethod: String(
            (session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown",
          ),
        }
      : null,
    cookieHeader,
  });
}
