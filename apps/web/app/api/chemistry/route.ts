import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadAllianceChemistry } from "../../../lib/chemistry/load-chemistry";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const teamKeys = url.searchParams.getAll("teamKey").filter(Boolean);
  const teamNumbers = url.searchParams.get("teams");
  if (teamNumbers) {
    for (const part of teamNumbers.split(/[,\s]+/).filter(Boolean)) {
      teamKeys.push(part);
    }
  }

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadAllianceChemistry(client, {
        orgId,
        userId: session.user.id,
        teamKeys,
      }),
    );
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not score alliance chemistry" },
      { status: 400 },
    );
  }
}
