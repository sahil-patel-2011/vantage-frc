import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeStandupView, defaultDigestDate, isDigestDate, type StandupView } from "../../../lib/standup";

export type { StandupView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function digestDateOrNull(value: unknown): string | null {
  return isDigestDate(value) ? value : null;
}

function setupFailure(digestDate: string): StandupView {
  return {
    status: "setup_required",
    message: "Could not load the standup digest. Choose your team and confirm database access.",
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
    ],
    orgId: null,
    digestDate,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const digestDate = digestDateOrNull(url.searchParams.get("date"));

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeStandupView(client, { userId: session.user.id, requestedOrg, digestDate }),
    );
    return Response.json(view);
  } catch {
    return Response.json(setupFailure(digestDate ?? defaultDigestDate()), { status: 200 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const digestDate = digestDateOrNull(body.digestDate);

  try {
    const view = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, (client) =>
      computeStandupView(client, { userId: session.user.id, requestedOrg: orgId, digestDate }),
    );
    return Response.json(view);
  } catch {
    return Response.json(setupFailure(digestDate ?? defaultDigestDate()), { status: 200 });
  }
}
