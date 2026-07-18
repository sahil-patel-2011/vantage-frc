import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export const DISCLOSURE_VERSION = "waitlist-2026-07-14";

const email = z.string().trim().toLowerCase().email().max(254).refine(
  (value) => value.split("@")[1]?.includes("."),
  "Enter a deliverable-looking email address",
);

export const waitlistSchema = z.object({
  email,
  teamNumber: z.coerce.number().int().min(1).max(99999),
  phone: z.string().trim().max(20).optional().default("").refine(
    (value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value),
    "Use E.164 format, such as +12025550123",
  ),
  smsConsent: z.boolean().optional().default(false),
  website: z.string().max(0).optional().default(""),
}).superRefine((value, context) => {
  if (value.phone && !value.smsConsent) {
    context.addIssue({
      code: "custom",
      path: ["smsConsent"],
      message: "SMS consent is required when a phone number is provided",
    });
  }
  if (!value.phone && value.smsConsent) {
    context.addIssue({
      code: "custom",
      path: ["phone"],
      message: "A phone number is required for SMS updates",
    });
  }
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;

export interface WaitlistEntry {
  email: string;
  teamNumber: number;
  phoneE164: string | null;
  launchInvitedAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistStore {
  upsert(input: WaitlistInput): Promise<void>;
  list(options?: { q?: string; limit?: number }): Promise<WaitlistEntry[]>;
  markLaunchInvited(email: string): Promise<WaitlistEntry | null>;
  markConverted(email: string): Promise<WaitlistEntry | null>;
}

type MemoryRow = WaitlistInput & {
  launchInvitedAt: Date | null;
  convertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const localRows = new Map<string, MemoryRow>();

function memoryToEntry(row: MemoryRow): WaitlistEntry {
  return {
    email: row.email,
    teamNumber: row.teamNumber,
    phoneE164: row.phone ? row.phone : null,
    launchInvitedAt: row.launchInvitedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function matchesQuery(entry: WaitlistEntry, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return entry.email.includes(needle) || String(entry.teamNumber).includes(needle);
}

export class MemoryWaitlistStore implements WaitlistStore {
  async upsert(input: WaitlistInput) {
    const key = input.email.toLowerCase();
    const existing = localRows.get(key);
    const now = new Date();
    localRows.set(key, {
      ...input,
      launchInvitedAt: existing?.launchInvitedAt ?? null,
      convertedAt: existing?.convertedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  get(emailAddress: string) {
    return localRows.get(emailAddress.toLowerCase());
  }

  clear() {
    localRows.clear();
  }

  async list(options?: { q?: string; limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);
    const rows = [...localRows.values()]
      .map(memoryToEntry)
      .filter((entry) => matchesQuery(entry, options?.q ?? ""))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows.slice(0, limit);
  }

  async markLaunchInvited(emailAddress: string) {
    const key = emailAddress.trim().toLowerCase();
    const row = localRows.get(key);
    if (!row) return null;
    const now = new Date();
    row.launchInvitedAt = row.launchInvitedAt ?? now;
    row.updatedAt = now;
    return memoryToEntry(row);
  }

  async markConverted(emailAddress: string) {
    const key = emailAddress.trim().toLowerCase();
    const row = localRows.get(key);
    if (!row) return null;
    const now = new Date();
    row.convertedAt = row.convertedAt ?? now;
    row.updatedAt = now;
    return memoryToEntry(row);
  }
}

type NeonWaitlistRow = {
  email: string;
  teamNumber: number;
  phoneE164: string | null;
  launchInvitedAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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
         ${input.smsConsent ? now : null}, ${DISCLOSURE_VERSION}, ${"unified-site"})
      ON CONFLICT (email_normalized) DO UPDATE SET
        team_number = EXCLUDED.team_number,
        phone_e164 = EXCLUDED.phone_e164,
        email_consent_at = EXCLUDED.email_consent_at,
        sms_consent_at = EXCLUDED.sms_consent_at,
        consent_disclosure_version = EXCLUDED.consent_disclosure_version,
        source = EXCLUDED.source,
        updated_at = now()`;
  }

  async list(options?: { q?: string; limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);
    const q = options?.q?.trim() ?? "";
    const pattern = q ? `%${q.toLowerCase()}%` : null;
    const rows = pattern
      ? await this.sql`
          SELECT email_normalized AS email,
                 team_number AS "teamNumber",
                 phone_e164 AS "phoneE164",
                 launch_invited_at AS "launchInvitedAt",
                 converted_at AS "convertedAt",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"
          FROM waitlist_signups
          WHERE lower(email_normalized) LIKE ${pattern}
             OR team_number::text LIKE ${pattern}
          ORDER BY updated_at DESC
          LIMIT ${limit}`
      : await this.sql`
          SELECT email_normalized AS email,
                 team_number AS "teamNumber",
                 phone_e164 AS "phoneE164",
                 launch_invited_at AS "launchInvitedAt",
                 converted_at AS "convertedAt",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"
          FROM waitlist_signups
          ORDER BY updated_at DESC
          LIMIT ${limit}`;
    return rows.map((row) => ({
      email: row.email,
      teamNumber: row.teamNumber,
      phoneE164: row.phoneE164,
      launchInvitedAt: row.launchInvitedAt ? new Date(row.launchInvitedAt).toISOString() : null,
      convertedAt: row.convertedAt ? new Date(row.convertedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
  }

  async markLaunchInvited(emailAddress: string) {
    const email = emailAddress.trim().toLowerCase();
    const rows = await this.sql`
      UPDATE waitlist_signups
      SET launch_invited_at = COALESCE(launch_invited_at, now()), updated_at = now()
      WHERE email_normalized = ${email}
      RETURNING email_normalized AS email,
                team_number AS "teamNumber",
                phone_e164 AS "phoneE164",
                launch_invited_at AS "launchInvitedAt",
                converted_at AS "convertedAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const row = rows[0];
    if (!row) return null;
    return {
      email: row.email,
      teamNumber: row.teamNumber,
      phoneE164: row.phoneE164,
      launchInvitedAt: row.launchInvitedAt ? new Date(row.launchInvitedAt).toISOString() : null,
      convertedAt: row.convertedAt ? new Date(row.convertedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  async markConverted(emailAddress: string) {
    const email = emailAddress.trim().toLowerCase();
    const rows = await this.sql`
      UPDATE waitlist_signups
      SET converted_at = COALESCE(converted_at, now()), updated_at = now()
      WHERE email_normalized = ${email}
      RETURNING email_normalized AS email,
                team_number AS "teamNumber",
                phone_e164 AS "phoneE164",
                launch_invited_at AS "launchInvitedAt",
                converted_at AS "convertedAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const row = rows[0];
    if (!row) return null;
    return {
      email: row.email,
      teamNumber: row.teamNumber,
      phoneE164: row.phoneE164,
      launchInvitedAt: row.launchInvitedAt ? new Date(row.launchInvitedAt).toISOString() : null,
      convertedAt: row.convertedAt ? new Date(row.convertedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}

const globalStore = globalThis as typeof globalThis & { vantageWaitlist?: MemoryWaitlistStore };

export function createWaitlistStore(): WaitlistStore {
  const url = process.env.MARKETING_DATABASE_URL ?? process.env.DATABASE_URL;
  if (url) {
    return new NeonWaitlistStore(url);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MARKETING_DATABASE_URL or DATABASE_URL is required in production");
  }
  return (globalStore.vantageWaitlist ??= new MemoryWaitlistStore());
}

