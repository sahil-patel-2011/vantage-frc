import { auth, isPlatformAdmin } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * Gate every `/admin` page. Non–platform-admins get a 404 so the surface
 * does not advertise that Global Team Manager / platform settings exist.
 */
export async function requirePlatformAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();
  const allowed = await withRls({ userId: session.user.id }, (client) => isPlatformAdmin(client));
  if (!allowed) notFound();
  return session;
}
