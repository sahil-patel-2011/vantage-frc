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

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isPasswordAuthBootstrappable() {
  return Boolean(process.env.PLATFORM_OWNER_PASSWORD) && isDatabaseConfigured();
}

export type AuthCapabilityReport = {
  waitlistOnly: true;
  publicSignup: false;
  databaseConfigured: boolean;
  emailOtpAvailable: boolean;
  passwordSignInAvailable: boolean;
  googleSignInAvailable: boolean;
  emailOtpReason: string | null;
  passwordReason: string | null;
  ownerEmailHint: string;
};

export function getAuthCapabilities(): AuthCapabilityReport {
  const databaseConfigured = isDatabaseConfigured();
  const emailProvider = isEmailProviderConfigured();
  const emailOtpAvailable = databaseConfigured && emailProvider;
  const passwordSignInAvailable = databaseConfigured;
  const ownerEmail = configuredPlatformOwnerEmail();
  return {
    waitlistOnly: true,
    publicSignup: false,
    databaseConfigured,
    emailOtpAvailable,
    passwordSignInAvailable,
    googleSignInAvailable: isGoogleAuthConfigured(),
    emailOtpReason: !databaseConfigured
      ? "Email sign-in is unavailable until DATABASE_AUTH_URL (or DATABASE_URL) is configured."
      : !emailProvider
        ? "Email sign-in is unavailable until RESEND_API_KEY and AUTH_EMAIL_FROM are configured."
        : null,
    passwordReason: !databaseConfigured
      ? "Password sign-in is unavailable until the production database is configured."
      : null,
    ownerEmailHint: ownerEmail,
  };
}

/** Treat blank env values as unset (Vercel can store empty strings). */
export function envOrFallback(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
