import { randomBytes } from "node:crypto";
import { requestPool } from "@vantage/db";
import { z } from "zod";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import {
  parseSecureJson,
  securityErrorResponse,
} from "../../../../lib/security/request";

const limiter = createRateLimiter({
  limit: 120,
  windowMs: 15 * 60_000,
  namespace: "team-code-join",
});
const input = z
  .object({
    teamNumber: z.number().int().min(1).max(99999),
    pin: z.string().regex(/^\d{6}$/),
    email: z.string().trim().email().max(254),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, input),
      ip = anonymizeIp(clientIp(request), "team-code-join");
    if (!(await limiter.allow(ip)))
      return rateLimitedResponse(
        "Too many attempts. Wait fifteen minutes and try again.",
      );
    const token = randomBytes(32).toString("base64url");
    const result = await requestPool.query<{ id: string | null }>(
      "SELECT request_team_code_invite($1,$2,$3,$4,$5) AS id",
      [body.teamNumber, body.pin, body.email.toLowerCase(), ip, token],
    );
    if (!result.rows[0]?.id)
      return Response.json(
        {
          error:
            "Check your team number and join code, or ask a team admin for an invitation. After several attempts, wait fifteen minutes.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      { href: `/invite?token=${encodeURIComponent(token)}` },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return securityErrorResponse(
      error,
      "Could not join this team. Try again or ask for an invitation.",
    );
  }
}
