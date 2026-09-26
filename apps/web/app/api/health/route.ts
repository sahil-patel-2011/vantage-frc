import { withRls } from "@vantage/db";

export const dynamic = "force-dynamic";

/** No one's identity: the check reads nothing but the clock. */
const NOBODY = "00000000-0000-0000-0000-000000000000";
const TIMEOUT_MS = 4_000;

/**
 * Uptime check for a monitor (Vercel, UptimeRobot, a status page): 200 when the app can reach its
 * database, 503 when it cannot. It says only that, never which host, driver or error, so it is
 * safe to leave public.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unreachable";
  try {
    await Promise.race([
      withRls({ userId: NOBODY }, async (client) => {
        await client.query("SELECT 1");
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    database = "ok";
  } catch {
    database = "unreachable";
  }
  const ok = database === "ok";
  return Response.json(
    { ok, database, checkedInMs: Date.now() - started },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
