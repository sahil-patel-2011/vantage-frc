import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const DISCLOSURE_VERSION = "waitlist-2026-07-14";

const email = z.string().trim().toLowerCase().email().max(254).refine(
  (value) => value.split("@")[1]?.includes("."),
  "Enter a deliverable-looking email address"
);

export const waitlistSchema = z.object({
  email,
  teamNumber: z.coerce.number().int().min(1).max(99999),
  phone: z.string().trim().max(20).optional().default("").refine(
    (value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value),
    "Use E.164 format, such as +12025550123"
  ),
  smsConsent: z.boolean().optional().default(false),
  website: z.string().max(0).optional().default("")
}).superRefine((value, context) => {
  if (value.phone && !value.smsConsent) {
    context.addIssue({
      code: "custom",
      path: ["smsConsent"],
      message: "SMS consent is required when a phone number is provided"
    });
  }
  if (!value.phone && value.smsConsent) {
    context.addIssue({
      code: "custom",
      path: ["phone"],
      message: "A phone number is required for SMS updates"
    });
  }
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type WaitlistRecord = WaitlistInput & { updatedAt: Date };

export interface WaitlistStore {
  upsert(input: WaitlistInput): Promise<void>;
}

const localRows = new Map<string, WaitlistRecord>();

export class MemoryWaitlistStore implements WaitlistStore {
  async upsert(input: WaitlistInput) {
    localRows.set(input.email, { ...input, updatedAt: new Date() });
  }
  get(emailAddress: string) {
    return localRows.get(emailAddress.toLowerCase());
  }
  clear() {
    localRows.clear();
  }
}

export class NeonWaitlistStore implements WaitlistStore {
  private readonly sql;
  constructor(url: string) {
    this.sql = neon(url);
  }
  async upsert(input: WaitlistInput) {
    const now = new Date();
    await this.sql`
      INSERT INTO waitlist_signups
        (email_normalized, team_number, phone_e164, email_consent_at,
         sms_consent_at, consent_disclosure_version, source)
      VALUES
        (${input.email}, ${input.teamNumber}, ${input.phone || null}, ${now},
         ${input.smsConsent ? now : null}, ${DISCLOSURE_VERSION}, ${"marketing-site"})
      ON CONFLICT (email_normalized) DO UPDATE SET
        team_number = EXCLUDED.team_number,
        phone_e164 = EXCLUDED.phone_e164,
        email_consent_at = EXCLUDED.email_consent_at,
        sms_consent_at = EXCLUDED.sms_consent_at,
        consent_disclosure_version = EXCLUDED.consent_disclosure_version,
        source = EXCLUDED.source,
        updated_at = now()`;
  }
}

const globalStore = globalThis as typeof globalThis & { vantageWaitlist?: MemoryWaitlistStore };

export function createWaitlistStore(): WaitlistStore {
  if (process.env.MARKETING_DATABASE_URL) {
    return new NeonWaitlistStore(process.env.MARKETING_DATABASE_URL);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MARKETING_DATABASE_URL is required in production");
  }
  return (globalStore.vantageWaitlist ??= new MemoryWaitlistStore());
}
