import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { addAlumni, loadAlumniDirectory, removeAlumni } from "../../../../lib/alumni";

// Team alumni network: a shared per-team directory of persisted rows. Any member
// can read and add alumni; RLS lets admins (or the original adder) delete.
// Empty when the org has no rows — never DEMO classmates.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Alumni request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, (client) =>
      loadAlumniDirectory(client, { orgId, userId: current.user.id }),
    );
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!orgId) throw new Error("orgId is required");
    const { id } = await withRls({ userId: current.user.id, orgId }, (client) =>
      addAlumni(client, { orgId, userId: current.user.id, body }),
    );
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const id = url.searchParams.get("id");
    if (!orgId || !id) throw new Error("orgId and id are required");
    await withRls({ userId: current.user.id, orgId }, (client) =>
      removeAlumni(client, { orgId, userId: current.user.id, id }),
    );
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
