// The shop-door QR (lib/hours/door-code). GET: an owner/admin's door screen asks for the current
// code. POST: a member who scanned it is checked in, or out if they were already in.
import { auth, resolveAuthSecret } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { doorCheckinPath, doorCode, verifyDoorCode } from "../../../../lib/hours/door-code";
import { toggleDoorCheckin } from "../../../../lib/hours/door-toggle";
import { publicErrorMessage } from "../../../../lib/security/public-error";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function session() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) throw new HttpError(401, "Sign in to check in.");
  return current;
}

async function roleIn(client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ role: string }> }> }, orgId: string, userId: string) {
  const result = await client.query(`SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [orgId, userId]);
  return result.rows[0]?.role ?? null;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: publicErrorMessage(error, "Check-in didn't go through.") }, { status });
}

export async function GET(request: Request) {
  try {
    const user = (await session()).user;
    const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(400, "Choose your team.");
    const role = await withRls({ userId: user.id, orgId }, (client) => roleIn(client, orgId, user.id));
    if (role !== "owner" && role !== "admin") throw new HttpError(403, "Only an owner or admin can open the door screen.");
    const code = doorCode(resolveAuthSecret(), orgId, Date.now());
    return Response.json({ path: doorCheckinPath(orgId, code), expiresAt: code.expiresAt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = (await session()).user;
    const body = (await request.json().catch(() => null)) as { orgId?: unknown; w?: unknown; s?: unknown } | null;
    const orgId = typeof body?.orgId === "string" ? body.orgId : "";
    const window = Number(body?.w);
    const sig = typeof body?.s === "string" ? body.s : "";
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(400, "That code isn't a Vantage door code.");
    if (!verifyDoorCode(resolveAuthSecret(), orgId, window, sig, Date.now())) {
      throw new HttpError(410, "That code has changed. Scan the one on the door now.");
    }
    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      const role = await roleIn(client, orgId, user.id);
      if (!role) throw new HttpError(403, "You're not on this team.");
      return toggleDoorCheckin(client, { orgId, userId: user.id, codeWindow: window });
    });
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
