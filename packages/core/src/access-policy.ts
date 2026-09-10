/** Canonical platform owner email used for first-user bootstrap. */
export const PLATFORM_OWNER_EMAIL_DEFAULT = "sahiljpatel2011@gmail.com";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function configuredPlatformOwnerEmail() {
  return normalizeEmail(process.env.PLATFORM_OWNER_EMAIL ?? PLATFORM_OWNER_EMAIL_DEFAULT);
}

export function isDatabaseConfigured() {
  return ["DATABASE_AUTH_URL", "DATABASE_URL", "DATABASE_ADMIN_URL", "POSTGRES_URL"].some((name) =>
    Boolean(runtimeEnv(name)),
  );
}

/** Avoid Next.js build-time inlining of `process.env.NAME` so Sensitive Vercel secrets remain runtime-readable. */
export function runtimeEnv(name: string) {
  const value = process.env[name]?.trim() || "";
  if (!value || value === "[SENSITIVE]") return "";
  return value;
}

/** Local OTP can use the in-memory mailbox. Production delivery needs Resend. */
export function isEmailProviderConfigured() {
  if (process.env.NODE_ENV !== "production") return true;
  return isEmailDeliveryConfigured();
}

/** Real outbound email (Resend). Password sign-in must not wait on this. */
export function isEmailDeliveryConfigured() {
  return Boolean(runtimeEnv("RESEND_API_KEY") && runtimeEnv("AUTH_EMAIL_FROM"));
}

export function isGoogleAuthConfigured() {
  const clientId = runtimeEnv("GOOGLE_CLIENT_ID");
  const clientSecret = runtimeEnv("GOOGLE_CLIENT_SECRET");
  return Boolean(clientId && clientSecret && clientId.endsWith(".apps.googleusercontent.com"));
}

export type SessionAuthMethod = "email_otp" | "password" | "google" | "desktop_link" | "unknown";

/** Map Better Auth request paths onto the session auth_method we persist. */
export function resolveSessionAuthMethod(path: string): SessionAuthMethod {
  const value = path.toLowerCase();
  if (value.includes("email-otp")) return "email_otp";
  if (value.includes("/sign-in/email") || value.includes("/sign-up/email")) return "password";
  if (value.includes("google") || value.includes("sign-in/social")) return "google";
  // Server-only mint for the desktop shell (desktop-link-plugin.ts).
  if (value.includes("desktop-link")) return "desktop_link";
  return "unknown";
}

/**
 * Google already proved the mailbox. Password still needs the email code when 2FA is on.
 * A desktop_link session can only be minted after a signed-in user — whose own session
 * already passed this gate in proxy.ts — explicitly approved the machine's code, so the
 * second factor was verified in the flow that authorized it.
 */
export function email2faSatisfiedByAuthMethod(method: SessionAuthMethod, enforced: boolean) {
  if (!enforced) return true;
  return method === "email_otp" || method === "google" || method === "desktop_link";
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function isLocalhostAuthOrigin(value: string) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** True for `next dev` / vitest — not a Vercel runtime, even if `.env.local` was pulled from Vercel. */
function isLocalAuthRuntime() {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";
}

/** Resolve the public auth origin for Better Auth callbacks (never use bare VERCEL_URL alone when BETTER_AUTH_URL is set). */
export function resolveAuthBaseURL() {
  const localOverride = runtimeEnv("BETTER_AUTH_URL_LOCAL");
  if (isLocalAuthRuntime() && localOverride) return stripTrailingSlash(localOverride);
  const explicit = runtimeEnv("BETTER_AUTH_URL") || runtimeEnv("NEXT_PUBLIC_APP_URL");
  if (explicit) {
    // `vercel env pull` copies production BETTER_AUTH_URL. Local Google OAuth must
    // callback to this machine, not vantage-frc-web.vercel.app.
    if (isLocalAuthRuntime() && !isLocalhostAuthOrigin(explicit)) {
      return "http://localhost:3001";
    }
    return stripTrailingSlash(explicit);
  }
  const productionHost = runtimeEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (productionHost) return `https://${stripTrailingSlash(productionHost)}`;
  const deploymentHost = runtimeEnv("VERCEL_URL");
  if (deploymentHost) return `https://${stripTrailingSlash(deploymentHost)}`;
  return "http://localhost:3001";
}

/** Origins allowed for Better Auth CSRF / callback checks. */
export function resolveAuthTrustedOrigins(baseURL: string) {
  const origins = new Set<string>();
  const addOrigin = (candidate: string) => {
    if (!candidate) return;
    try {
      const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
      const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol === "https:" || localHttp) origins.add(url.origin);
    } catch {
      // Ignore malformed optional origins instead of weakening the allowlist.
    }
  };
  addOrigin(baseURL);
  addOrigin("https://vantage-frc-web.vercel.app");
  addOrigin(runtimeEnv("NEXT_PUBLIC_APP_URL"));
  addOrigin(runtimeEnv("NEXT_PUBLIC_SITE_URL"));
  const productionHost = runtimeEnv("VERCEL_PROJECT_PRODUCTION_URL");
  addOrigin(productionHost);
  addOrigin(runtimeEnv("VERCEL_URL"));
  for (const configured of runtimeEnv("AUTH_TRUSTED_ORIGINS").split(",")) addOrigin(configured.trim());
  // `next dev` is :3001; Playwright's `dev:test` is :3310. Better Auth logs
  // "Invalid origin" and rejects CSRF on the suite origin unless both are listed.
  if (process.env.NODE_ENV !== "production") {
    addOrigin("http://localhost:3001");
    addOrigin("http://127.0.0.1:3001");
    addOrigin("http://localhost:3310");
    addOrigin("http://127.0.0.1:3310");
  }
  return [...origins];
}

/** True when the request carries a Better Auth session token (not the E2E fixture cookie). */
export function hasBetterAuthSessionCookie(cookieHeader: string | null | undefined): boolean {
  const match = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]*)/i.exec(cookieHeader ?? "");
  return Boolean(match?.[1]?.trim());
}

export function resolveAuthSecret(
  configured = runtimeEnv("BETTER_AUTH_SECRET"),
  environment = process.env.NODE_ENV,
) {
  if (configured.trim()) return configured.trim();
  if (environment === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
  }
  return "local-development-secret-change-me";
}

/** Safe, non-secret diagnostics for production Google OAuth wiring. */
export function getGoogleAuthEnvDiagnostics() {
  const clientId = runtimeEnv("GOOGLE_CLIENT_ID");
  const clientSecret = runtimeEnv("GOOGLE_CLIENT_SECRET");
  const baseURL = resolveAuthBaseURL();
  return {
    googleClientIdSet: Boolean(clientId),
    googleClientSecretSet: Boolean(clientSecret),
    googleClientIdLooksValid: clientId.endsWith(".apps.googleusercontent.com"),
    googleClientSecretLooksValid: clientSecret.startsWith("GOCSPX-"),
    googleClientIdLength: clientId.length,
    googleClientSecretLength: clientSecret.length,
    authBaseURL: baseURL,
    googleCallbackURL: `${baseURL}/api/auth/callback/google`,
    trustedOrigins: resolveAuthTrustedOrigins(baseURL),
  };
}

export function isPasswordAuthBootstrappable() {
  return Boolean(process.env.PLATFORM_OWNER_PASSWORD) && isDatabaseConfigured();
}

export type AuthCapabilityReport = {
  waitlistOnly: true;
  publicSignup: false;
  databaseConfigured: boolean;
  emailOtpAvailable: boolean;
  email2faEnforced: boolean;
  email2faBypassEnabled: boolean;
  passwordSignInAvailable: boolean;
  googleSignInAvailable: boolean;
  emailOtpReason: string | null;
  passwordReason: string | null;
  ownerEmailHint: string;
  googleClientIdSet: boolean;
  googleClientSecretSet: boolean;
  googleClientIdLooksValid: boolean;
  googleClientSecretLooksValid: boolean;
  authBaseURL: string;
  googleCallbackURL: string;
};

export type PublicAuthCapabilityReport = Pick<
  AuthCapabilityReport,
  | "waitlistOnly"
  | "publicSignup"
  | "databaseConfigured"
  | "emailOtpAvailable"
  | "email2faEnforced"
  | "passwordSignInAvailable"
  | "googleSignInAvailable"
  | "emailOtpReason"
  | "passwordReason"
>;

export function getAuthCapabilities(): AuthCapabilityReport {
  const databaseConfigured = isDatabaseConfigured();
  const emailProvider = isEmailProviderConfigured();
  const emailOtpAvailable = databaseConfigured && emailProvider;
  const passwordSignInAvailable = databaseConfigured;
  const ownerEmail = configuredPlatformOwnerEmail();
  const google = getGoogleAuthEnvDiagnostics();
  const bypass = runtimeEnv("ENABLE_EMAIL_2FA_BYPASS") === "true";
  const email2faEnforced = databaseConfigured && isEmailDeliveryConfigured() && !bypass;
  return {
    waitlistOnly: true,
    publicSignup: false,
    databaseConfigured,
    emailOtpAvailable,
    email2faEnforced,
    email2faBypassEnabled: bypass,
    passwordSignInAvailable,
    googleSignInAvailable: isGoogleAuthConfigured(),
    emailOtpReason: !databaseConfigured
      ? "Email verification is unavailable until DATABASE_AUTH_URL, DATABASE_URL, or POSTGRES_URL is configured."
      : !emailProvider
        ? "Email 2FA / OTP is unavailable until RESEND_API_KEY and AUTH_EMAIL_FROM are configured."
        : null,
    passwordReason: !databaseConfigured
      ? "Password sign-in is unavailable until the production database is configured."
      : null,
    ownerEmailHint: ownerEmail,
    googleClientIdSet: google.googleClientIdSet,
    googleClientSecretSet: google.googleClientSecretSet,
    googleClientIdLooksValid: google.googleClientIdLooksValid,
    googleClientSecretLooksValid: google.googleClientSecretLooksValid,
    authBaseURL: google.authBaseURL,
    googleCallbackURL: google.googleCallbackURL,
  };
}

/** Browser-safe auth capabilities: no owner identity, environment diagnostics, or bypass state. */
export function getPublicAuthCapabilities(): PublicAuthCapabilityReport {
  const report = getAuthCapabilities();
  return {
    waitlistOnly: report.waitlistOnly,
    publicSignup: report.publicSignup,
    databaseConfigured: report.databaseConfigured,
    emailOtpAvailable: report.emailOtpAvailable,
    email2faEnforced: report.email2faEnforced,
    passwordSignInAvailable: report.passwordSignInAvailable,
    googleSignInAvailable: report.googleSignInAvailable,
    emailOtpReason: report.emailOtpReason
      ? "Email code sign-in is temporarily unavailable. Use another enabled method or contact your team leader."
      : null,
    passwordReason: report.passwordReason
      ? "Password sign-in is temporarily unavailable. Use another enabled method or contact your team leader."
      : null,
  };
}

/** Treat blank env values as unset (Vercel can store empty strings). */
export function envOrFallback(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
