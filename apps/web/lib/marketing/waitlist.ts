import { z } from "zod";
import { LEGAL_DOC_VERSION } from "@vantage/core";
import { createSqlPool } from "@vantage/db/pool";
import { resolveMarketingDatabaseUrl } from "@vantage/db/postgres-url";
import { waitlistUnavailableMessage } from "./waitlist-copy";

export const DISCLOSURE_VERSION = `waitlist-${LEGAL_DOC_VERSION}`;

const email = z.string().trim().toLowerCase().email().max(254).refine(
  (value) => value.split("@")[1]?.includes("."),
  "Enter a deliverable-looking email address",
);

export const waitlistSchema = z.object({
  email,
  teamNumber: z.coerce.number().int().min(1).max(99999),
  phone: z.string().trim().max(20).optional().default("").refine(
    (value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value),
    "Use a phone number with country code, like +12025550123",
  ),
  smsConsent: z.boolean().optional().default(false),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
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

type WaitlistRow = {
  email: string;
  teamNumber: number;
  phoneE164: string | null;
  launchInvitedAt: Date | string | null;
  convertedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const WAITLIST_RETURNING = `email_normalized AS email,
                team_number AS "teamNumber",
                phone_e164 AS "phoneE164",
                launch_invited_at AS "launchInvitedAt",
                converted_at AS "convertedAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;

function mapWaitlistRow(row: WaitlistRow): WaitlistEntry {
  return {
    email: row.email,
    teamNumber: Number(row.teamNumber),
    phoneE164: row.phoneE164,
    launchInvitedAt: row.launchInvitedAt ? new Date(row.launchInvitedAt).toISOString() : null,
    convertedAt: row.convertedAt ? new Date(row.convertedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

let waitlistPool: ReturnType<typeof createSqlPool> | undefined;

/** Postgres-backed waitlist (Neon today; node-postgres on a Supabase host). */
export class NeonWaitlistStore implements WaitlistStore {
  constructor(private readonly url: string) {}

  private pool() {
    waitlistPool ??= createSqlPool(this.url);
    return waitlistPool;
  }

  async upsert(input: WaitlistInput) {
    const now = new Date();
    await this.pool().query(
      `INSERT INTO waitlist_signups
        (email_normalized, team_number, phone_e164, email_consent_at,
         sms_consent_at, consent_disclosure_version, source)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email_normalized) DO UPDATE SET
        team_number = EXCLUDED.team_number,
        phone_e164 = EXCLUDED.phone_e164,
        email_consent_at = EXCLUDED.email_consent_at,
        sms_consent_at = EXCLUDED.sms_consent_at,
        consent_disclosure_version = EXCLUDED.consent_disclosure_version,
        source = EXCLUDED.source,
        updated_at = now()`,
      [
        input.email,
        input.teamNumber,
        input.phone || null,
        now,
        input.smsConsent ? now : null,
        DISCLOSURE_VERSION,
        "unified-site",
      ],
    );
  }

  async list(options?: { q?: string; limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);
    const q = options?.q?.trim() ?? "";
    const pattern = q ? `%${q.toLowerCase()}%` : null;
    const result = pattern
      ? await this.pool().query<WaitlistRow>(
          `SELECT ${WAITLIST_RETURNING}
          FROM waitlist_signups
          WHERE lower(email_normalized) LIKE $1
             OR team_number::text LIKE $1
          ORDER BY updated_at DESC
          LIMIT $2`,
          [pattern, limit],
        )
      : await this.pool().query<WaitlistRow>(
          `SELECT ${WAITLIST_RETURNING}
          FROM waitlist_signups
          ORDER BY updated_at DESC
          LIMIT $1`,
          [limit],
        );
    return result.rows.map(mapWaitlistRow);
  }

  async markLaunchInvited(emailAddress: string) {
    const email = emailAddress.trim().toLowerCase();
    const result = await this.pool().query<WaitlistRow>(
      `UPDATE waitlist_signups
       SET launch_invited_at = COALESCE(launch_invited_at, now()), updated_at = now()
       WHERE email_normalized = $1
       RETURNING ${WAITLIST_RETURNING}`,
      [email],
    );
    const row = result.rows[0];
    return row ? mapWaitlistRow(row) : null;
  }

  async markConverted(emailAddress: string) {
    const email = emailAddress.trim().toLowerCase();
    const result = await this.pool().query<WaitlistRow>(
      `UPDATE waitlist_signups
       SET converted_at = COALESCE(converted_at, now()), updated_at = now()
       WHERE email_normalized = $1
       RETURNING ${WAITLIST_RETURNING}`,
      [email],
    );
    const row = result.rows[0];
    return row ? mapWaitlistRow(row) : null;
  }
}

const globalStore = globalThis as typeof globalThis & { vantageWaitlist?: MemoryWaitlistStore };

export type WaitlistBackend = "memory" | "postgres" | "unavailable";

export { waitlistUnavailableCopy } from "./waitlist-copy";
export { waitlistUnavailableMessage };

/**
 * How the public form persists names. Production without a marketing database
 * is `unavailable` — never a thrown 500 on the landing page.
 */
export function waitlistBackend(): WaitlistBackend {
  if (process.env.CI === "true") return "memory";
  if (resolveMarketingDatabaseUrl()) return "postgres";
  if (process.env.NODE_ENV === "production") return "unavailable";
  return "memory";
}

export class WaitlistUnavailableError extends Error {
  readonly status = "setup_required" as const;
  constructor() {
    super(waitlistUnavailableMessage());
    this.name = "WaitlistUnavailableError";
  }
}

export function createWaitlistStore(): WaitlistStore {
  const memory = (globalStore.vantageWaitlist ??= new MemoryWaitlistStore());
  const backend = waitlistBackend();
  switch (backend) {
    case "memory":
      return memory;
    case "postgres": {
      const url = resolveMarketingDatabaseUrl();
      return url ? new NeonWaitlistStore(url) : memory;
    }
    case "unavailable":
      throw new WaitlistUnavailableError();
    default: {
      const _never: never = backend;
      throw new Error(`Unhandled waitlist backend: ${String(_never)}`);
    }
  }
}

