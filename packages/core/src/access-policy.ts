/** Canonical platform owner email used for first-user bootstrap. */
export const PLATFORM_OWNER_EMAIL_DEFAULT = "sahiljpatel2011@gmail.com";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function configuredPlatformOwnerEmail() {
  return normalizeEmail(process.env.PLATFORM_OWNER_EMAIL ?? PLATFORM_OWNER_EMAIL_DEFAULT);
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_AUTH_URL || process.env.DATABASE_URL || process.env.DATABASE_ADMIN_URL);
}

export function isEmailProviderConfigured() {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
}

/** Avoid Next.js build-time inlining of `process.env.NAME` so Sensitive Vercel secrets remain runtime-readable. */
export function runtimeEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function isGoogleAuthConfigured() {
  return Boolean(runtimeEnv("GOOGLE_CLIENT_ID") && runtimeEnv("GOOGLE_CLIENT_SECRET"));
}

/** Resolve the public auth origin for Better Auth callbacks (never use bare VERCEL_URL alone when BETTER_AUTH_URL is set). */
export function resolveAuthBaseURL() {
  const explicit = runtimeEnv("BETTER_AUTH_URL") || runtimeEnv("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const productionHost = runtimeEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (productionHost) return `https://${productionHost.replace(/\/$/, "")}`;
  const deploymentHost = runtimeEnv("VERCEL_URL");
  if (deploymentHost) return `https://${deploymentHost.replace(/\/$/, "")}`;
  return "http://localhost:3001";
}

/** Origins allowed for Better Auth CSRF / callback checks. */
export function resolveAuthTrustedOrigins(baseURL: string) {
  const origins = new Set<string>([
    baseURL.replace(/\/$/, ""),
    "https://vantage-frc-web.vercel.app",
    "https://vantage-frc-web-sahil-patel-s-projects1.vercel.app",
  ]);
  const appUrl = runtimeEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  if (appUrl) origins.add(appUrl);
  const productionHost = runtimeEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (productionHost) origins.add(`https://${productionHost.replace(/\/$/, "")}`);
  return [...origins];
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

export function getAuthCapabilities(): AuthCapabilityReport {
  const databaseConfigured = isDatabaseConfigured();
  const emailProvider = isEmailProviderConfigured();
  const emailOtpAvailable = databaseConfigured && emailProvider;
  const passwordSignInAvailable = databaseConfigured;
  const ownerEmail = configuredPlatformOwnerEmail();
  const google = getGoogleAuthEnvDiagnostics();
  const bypass = process.env.ENABLE_EMAIL_2FA_BYPASS?.trim() === "true";
  const email2faEnforced = emailOtpAvailable && !bypass;
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
      ? "Email verification is unavailable until DATABASE_AUTH_URL (or DATABASE_URL) is configured."
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

/** Treat blank env values as unset (Vercel can store empty strings). */
export function envOrFallback(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
