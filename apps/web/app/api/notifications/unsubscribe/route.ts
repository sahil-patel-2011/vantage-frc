import {
  applyUnsubscribeByToken,
  isEmailNotificationCategory,
  type EmailNotificationCategory,
} from "@vantage/core";
import { requestPool } from "@vantage/db";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().trim().min(24).max(200),
  category: z.string().trim().min(1).max(64).optional(),
});

function normalizeCategory(raw: string | undefined): EmailNotificationCategory | "all" {
  if (!raw || raw === "all") return "all";
  if (isEmailNotificationCategory(raw)) return raw;
  return "all";
}

/** Public one-click unsubscribe — token-gated SECURITY DEFINER path; no session required. */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "A valid unsubscribe token is required." }, { status: 400 });
  }

  const category = normalizeCategory(parsed.data.category);
  if (parsed.data.category && parsed.data.category !== "all" && !isEmailNotificationCategory(parsed.data.category)) {
    return Response.json({ error: "Unknown email category." }, { status: 400 });
  }

  const client = await requestPool.connect();
  try {
    await client.query("BEGIN");
    const ok = await applyUnsubscribeByToken(client, parsed.data.token, category);
    await client.query("COMMIT");
    if (!ok) return Response.json({ error: "Unsubscribe link is invalid or expired." }, { status: 404 });
    return Response.json({ ok: true, category });
  } catch {
    await client.query("ROLLBACK");
    return Response.json({ error: "Could not update email preferences." }, { status: 500 });
  } finally {
    client.release();
  }
}
