#!/usr/bin/env node
/**
 * Print the sign-in code a local dev server will accept for an email.
 *
 * Outside production the auth config generates OTPs with
 * `deterministicLocalOtp` rather than mailing them, so a local sign-in needs no
 * mail provider and no inbox. This prints the same number that function
 * returns.
 *
 * It is a pure HMAC of the email, the type and DEV_OTP_SECRET, so it reveals
 * nothing about production: there, `generateOTP` is undefined and Better Auth
 * uses real random codes delivered by email.
 *
 *   node scripts/dev-otp.mjs owner@example.test
 */

import { createHmac } from "node:crypto";

const email = process.argv[2];
const type = process.argv[3] ?? "sign-in";

if (!email) {
  console.error("Usage: node scripts/dev-otp.mjs <email> [type]");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run with NODE_ENV=production: these codes are dev-only.");
  process.exit(1);
}

// Mirrors deterministicLocalOtp in packages/core/src/email.ts. Duplicated
// rather than imported so this runs without building the workspace, which is
// the point of a one-line helper.
const secret = process.env.DEV_OTP_SECRET ?? "vantage-local-otp";
const digest = createHmac("sha256", secret)
  .update(`${email.trim().toLowerCase()}:${type}`)
  .digest()
  .readUInt32BE(0);

console.log(String(digest % 1_000_000).padStart(6, "0"));
