import type { PoolClient } from "@neondatabase/serverless";

/** Thrown when a caller lacks a `platform_admins` row. Prefer mapping to HTTP 404. */
export class PlatformAdminRequiredError extends Error {
  readonly status = 404 as const;

  constructor(message = "Not found") {
    super(message);
    this.name = "PlatformAdminRequiredError";
  }
}

export async function isPlatformAdmin(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>("SELECT is_platform_admin() AS allowed");
  return result.rows[0]?.allowed === true;
}

/** Fail closed unless the current RLS user is in `platform_admins`. */
export async function assertPlatformAdmin(client: PoolClient): Promise<void> {
  if (!(await isPlatformAdmin(client))) throw new PlatformAdminRequiredError();
}

export function platformAdminDeniedResponse(error: unknown): Response {
  if (error instanceof PlatformAdminRequiredError) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (/authentication required/i.test(message)) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (/platform administrator/i.test(message)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ error: message }, { status: 403 });
}
