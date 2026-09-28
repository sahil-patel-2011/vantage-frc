/** December 1, 2026 at midnight in America/New_York; readiness is still required. */
export const PUBLIC_SIGNUP_EARLIEST = "2026-12-01T05:00:00.000Z";
export const PUBLIC_SIGNUP_ENV_VALUE = "open";

export function publicSignupDateReached(now: Date = new Date()): boolean {
  return Number.isFinite(now.getTime()) && now.getTime() >= Date.parse(PUBLIC_SIGNUP_EARLIEST);
}

export function publicSignupEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VANTAGE_PUBLIC_SIGNUP ?? "").trim().toLowerCase() === PUBLIC_SIGNUP_ENV_VALUE;
}

/** Exercise real signup against an isolated local database without asserting production readiness. */
export function isLocalAcceptanceSignup(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VANTAGE_LOCAL_ACCEPTANCE_SIGNUP !== "1" || env.NODE_ENV !== "development" || env.VERCEL === "1") return false;
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  try {
    const origins = [env.BETTER_AUTH_URL, env.NEXT_PUBLIC_APP_URL].filter((value): value is string => Boolean(value?.trim()));
    if (!origins.length || !origins.every(value => {
      const origin = new URL(value);
      return ["http:", "https:"].includes(origin.protocol) && loopback(origin.hostname);
    })) return false;
    const databases = [env.DATABASE_AUTH_URL, env.DATABASE_URL, env.POSTGRES_URL, env.DATABASE_ADMIN_URL,
      env.DATABASE_WORKER_URL, env.DATABASE_PAIRING_URL, env.DATABASE_AI_BRIDGE_URL, env.DATABASE_TRAINING_URL,
      env.MARKETING_DATABASE_URL, env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING]
      .filter((value): value is string => Boolean(value?.trim()));
    return databases.length > 0 && databases.every(value => {
      const database = new URL(value);
      return ["postgres:", "postgresql:"].includes(database.protocol) && loopback(database.hostname)
        && /(?:^|_)test(?:_|$)/.test(decodeURIComponent(database.pathname.slice(1)))
        && !["host", "hostaddr", "service"].some(key => database.searchParams.has(key));
    });
  } catch { return false; }
}

export function isPublicSignupOpen(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  return Number.isFinite(now.getTime()) && (isLocalAcceptanceSignup(env)
    || (publicSignupDateReached(now) && publicSignupEnvEnabled(env) && env.VANTAGE_PRODUCTION_VERIFIED === "1"));
}

export type PublicSignupStatus = {
  open: boolean;
  earliest: string;
  dateReached: boolean;
  envEnabled: boolean;
  readinessVerified: boolean;
  localAcceptance: boolean;
  reason: string;
};

export function publicSignupStatus(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): PublicSignupStatus {
  const dateReached = publicSignupDateReached(now);
  const envEnabled = publicSignupEnvEnabled(env);
  const readinessVerified = env.VANTAGE_PRODUCTION_VERIFIED === "1";
  const localAcceptance = isLocalAcceptanceSignup(env);
  const open = isPublicSignupOpen(now, env);
  const reason = !Number.isFinite(now.getTime()) ? "Signup is closed because the server clock is invalid."
    : localAcceptance ? "Local acceptance signup is enabled for an isolated test database. Production remains unverified."
    : !dateReached ? "Public sign-up is scheduled for December 1, 2026 (Eastern Time), subject to production verification. Contact vantagefrc@gmail.com for early access."
    : open ? "Public sign-up is open."
    : !readinessVerified ? "Public sign-up is closed until production verification passes (VANTAGE_PRODUCTION_VERIFIED=1)."
    : "Production is verified. Set VANTAGE_PUBLIC_SIGNUP=open to allow sign-up.";
  return { open, earliest: PUBLIC_SIGNUP_EARLIEST, dateReached, envEnabled, readinessVerified, localAcceptance, reason };
}
