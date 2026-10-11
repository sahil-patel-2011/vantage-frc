/**
 * Request limits on the Better Auth routes (`/api/auth/*`).
 *
 * Better Auth counts per IP address and per path. A whole team usually reaches Vantage from one
 * address: a school network, or the venue Wi-Fi at an event. So a limit is sized for a room of
 * about thirty people doing ordinary things at once, and only routes where a request is a guess
 * (a code, a password) stay strict. Paths are relative to `/api/auth`.
 *
 * - Session reads (`/get-session`) happen on every page load and every focus refresh. Reading a
 *   session cannot guess anything: the cookie is a long random token checked in the database. At
 *   sixty a minute, a team scouting from one gym saw 429s, and Home said "Couldn't load your team".
 * - Starting Google sign-in (`/sign-in/social`) only builds a redirect; the password is typed at
 *   Google. Better Auth's built-in rule for `/sign-in*` (three per ten seconds) is for passwords.
 * - Sign-in codes keep their own limit in `OTP_POLICY` (index.ts): forty sends or tries a minute
 *   per address, five tries per code, then the code is thrown away. Password sign-in keeps
 *   Better Auth's built-in rule. Neither is changed here.
 */
export type AuthRateLimitRule = { window: number; max: number };

/** Every path without a rule of its own. */
export const AUTH_RATE_LIMIT_DEFAULT: AuthRateLimitRule = { window: 60, max: 60 };

export const AUTH_RATE_LIMIT_RULES: Record<string, AuthRateLimitRule> = {
  // Thirty people, a page every few seconds each, plus focus refreshes, from one address.
  "/get-session": { window: 60, max: 1200 },
  "/list-sessions": { window: 60, max: 240 },
  "/sign-in/social": { window: 60, max: 120 },
  "/callback/*": { window: 60, max: 120 },
  "/sign-out": { window: 60, max: 120 },
};
