import { createEmailProvider, resolveAuthBaseURL } from "@vantage/core";
import { signConsoleToken } from "./console-token";
import type { OwnerMail, ReporterDeps } from "./incident";
import { getOutageStore } from "./status-store";

/**
 * The real wiring for the outage reporter: the shared store, the configured email provider,
 * PLATFORM_OWNER_EMAIL, and signed console links. Imported lazily by incident.ts.
 */

function env(name: string) {
  const value = process.env[name]?.trim() || "";
  return value === "[SENSITIVE]" ? "" : value;
}

/** Only PLATFORM_OWNER_EMAIL itself: an outage alert never falls back to another address. */
export function outageOwnerEmail(): string | null {
  const email = env("PLATFORM_OWNER_EMAIL").toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function outageConsoleUrl(incidentId: string): string | null {
  const token = signConsoleToken(incidentId);
  if (!token) return null;
  return `${resolveAuthBaseURL()}/status/outage?t=${encodeURIComponent(token)}`;
}

export const EMAIL_SETUP_MESSAGE =
  "Email isn't set up: add RESEND_API_KEY and AUTH_EMAIL_FROM (or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD) in Vercel.";

/**
 * Outside production (a laptop whose local Postgres is stopped) an alert is logged, not sent,
 * unless OUTAGE_ALERTS_IN_DEV=1.
 */
export async function sendOutageEmail(mail: OwnerMail): Promise<void> {
  if (process.env.NODE_ENV !== "production" && env("OUTAGE_ALERTS_IN_DEV") !== "1") {
    console.info(`[outage] (not production) would email the owner: ${mail.subject}`);
    return;
  }
  const provider = createEmailProvider();
  if (provider.name === "unconfigured") throw new Error(EMAIL_SETUP_MESSAGE);
  await provider.sendFreeform(mail);
}

export function defaultReporterDeps(): ReporterDeps {
  const zone = env("OUTAGE_ALERT_TIMEZONE");
  return {
    store: getOutageStore(),
    sendOwnerEmail: sendOutageEmail,
    ownerEmail: outageOwnerEmail,
    consoleUrl: outageConsoleUrl,
    ...(zone ? { timeZone: zone } : {}),
  };
}
