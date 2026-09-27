export const MINIMUM_ACCOUNT_AGE = 13;
export const AGE_ELIGIBILITY_MESSAGE = "Vantage accounts are available to people age 13 and older.";

/** Calendar birthdays, including leap years; never use 365-day approximations. */
export function meetsMinimumAge(dateOfBirth: Date, now: Date = new Date()): boolean {
  if (!Number.isFinite(dateOfBirth.getTime()) || !Number.isFinite(now.getTime())) return false;
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  if (now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate())) age--;
  return age >= MINIMUM_ACCOUNT_AGE;
}

export function assertMinimumAge(dateOfBirth: Date, now?: Date): void {
  if (!meetsMinimumAge(dateOfBirth, now)) throw new Error(AGE_ELIGIBILITY_MESSAGE);
}

/** Membership entry requires a saved eligible birthday, including direct invite acceptance. */
export async function assertAccountAgeConfirmed(client: PoolClient, userId: string): Promise<void> {
  const result = await client.query<{ eligible: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=$1::uuid AND date_of_birth IS NOT NULL
      AND date_of_birth <= (CURRENT_DATE - interval '13 years')::date) AS eligible`, [userId],
  );
  if (!result.rows[0]?.eligible) {
    const error = new Error(`Finish your profile first. ${AGE_ELIGIBILITY_MESSAGE}`);
    Object.assign(error, { status: 403, code: "AGE_ELIGIBILITY_REQUIRED" });
    throw error;
  }
}
import type { PoolClient } from "@neondatabase/serverless";
