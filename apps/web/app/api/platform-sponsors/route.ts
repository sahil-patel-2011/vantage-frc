import { auth, listActiveSponsorBrands } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/** Soft-UI AI branding — active sponsors only; never notes or secrets. */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const sponsors = await withRls({ userId: session.user.id }, (client) =>
      listActiveSponsorBrands(client),
    );
    return Response.json(
      { sponsors },
      { headers: { "cache-control": "private, max-age=60" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load sponsors", sponsors: [] },
      { status: 200 },
    );
  }
}
