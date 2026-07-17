import { timingSafeEqual } from "node:crypto";
import { bootstrapPlatformOwner, getAuthCapabilities } from "@vantage/core";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";

function tokensEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000, namespace: "bootstrap-owner" });

/**
 * One-time bootstrap for the platform owner.
 * Requires BOOTSTRAP_TOKEN + PLATFORM_OWNER_PASSWORD in environment.
 * Never returns or logs the password.
 */
export async function POST(request: Request) {
  const ipKey = anonymizeIp(clientIp(request), "bootstrap");
  if (!(await limiter.allow(ipKey))) {
    return rateLimitedResponse("Too many bootstrap attempts. Try again later.");
  }

  const bootstrapToken = process.env.BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    return Response.json({ error: "Bootstrap is not armed. Set BOOTSTRAP_TOKEN to enable." }, { status: 404 });
  }

  const provided = request.headers.get("x-bootstrap-token") ?? "";
  if (!provided || !tokensEqual(provided, bootstrapToken)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const capabilities = getAuthCapabilities();
  if (!capabilities.databaseConfigured) {
    return Response.json(
      {
        error: "Database not configured",
        blockers: ["DATABASE_ADMIN_URL or DATABASE_URL", "BETTER_AUTH_SECRET", "PLATFORM_OWNER_PASSWORD"],
      },
      { status: 503 },
    );
  }

  try {
    const result = await bootstrapPlatformOwner();
    return Response.json({
      ok: true,
      email: result.email,
      createdUser: result.createdUser,
      updatedPassword: result.updatedPassword,
      grantedPlatformAdmin: result.grantedPlatformAdmin,
      next: "Sign in with email + password on /signin. Rotate PLATFORM_OWNER_PASSWORD and remove BOOTSTRAP_TOKEN after success.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bootstrap failed" },
      { status: 400 },
    );
  }
}
