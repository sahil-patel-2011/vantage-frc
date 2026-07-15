/**
 * Idempotent platform-owner seed.
 *
 * Required env (never commit secrets):
 * - PLATFORM_OWNER_EMAIL (defaults to sahiljpatel2011@gmail.com)
 * - PLATFORM_OWNER_PASSWORD (min 12 chars)
 * - DATABASE_ADMIN_URL or DATABASE_URL
 *
 * Usage:
 *   npx tsx scripts/bootstrap-platform-owner.ts
 */
import { bootstrapPlatformOwner } from "../packages/core/src/bootstrap-owner.ts";

async function main() {
  const result = await bootstrapPlatformOwner();
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        email: result.email,
        createdUser: result.createdUser,
        updatedPassword: result.updatedPassword,
        grantedPlatformAdmin: result.grantedPlatformAdmin,
        next: "Sign in at /signin with email + password. Rotate PLATFORM_OWNER_PASSWORD after first successful login.",
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed");
  process.exitCode = 1;
});
