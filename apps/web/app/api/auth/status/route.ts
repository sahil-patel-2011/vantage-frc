import { getPublicAuthCapabilities } from "@vantage/core";
import { isBackupMode } from "@vantage/db/backup-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const capabilities = getPublicAuthCapabilities();
  // Backup mode: no database, so no way to sign in or sign up, whatever the env would allow.
  const report = isBackupMode()
    ? {
        ...capabilities,
        publicSignup: false,
        databaseConfigured: false,
        emailOtpAvailable: false,
        passwordSignInAvailable: false,
        googleSignInAvailable: false,
      }
    : capabilities;
  const response = Response.json(report);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
