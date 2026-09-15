import { createHmac, timingSafeEqual } from "node:crypto";

/** Cookie written by `/claim` so Google and email can create the first coach account. */
export const CLAIM_INTENT_COOKIE = "vantage_claim";

export function createClaimIntentToken(teamNumber: number, secret: string): string {
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
    throw new Error("Team number must be between 1 and 99999");
  }
  const hmac = createHmac("sha256", secret).update(`vantage-claim:${teamNumber}`).digest("hex");
  return `${teamNumber}.${hmac}`;
}

export function parseClaimIntentToken(token: string | null | undefined, secret: string): number | null {
  const value = token?.trim() ?? "";
  const match = /^(\d{1,5})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const teamNumber = Number(match[1]);
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) return null;
  const expected = createHmac("sha256", secret).update(`vantage-claim:${teamNumber}`).digest("hex");
  const given = Buffer.from(match[2], "hex");
  const want = Buffer.from(expected, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return teamNumber;
}
