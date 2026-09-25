import { z } from "zod";
import { LEGAL_DOC_VERSION } from "@vantage/core";
import { createSqlPool } from "@vantage/db/pool";
import { resolveMarketingDatabaseUrl } from "@vantage/db/postgres-url";
import { waitlistUnavailableMessage } from "./waitlist-copy";

export const DISCLOSURE_VERSION = `waitlist-${LEGAL_DOC_VERSION}`;

const email = z.string().trim().toLowerCase().email("Enter an email address, like you@school.org.").max(254).refine(
  (value) => value.split("@")[1]?.includes("."),
  "Enter a deliverable-looking email address",
);

export const waitlistSchema = z.object({
  email,
  // The server's own words reach the form when the browser check is skipped: "Too small:
  // expected number to be >=1" read like a crash.
  teamNumber: z.coerce
    .number({ message: "Enter your FRC team number, like 6925." })
    .int("Team numbers are digits only, 1 to 99999.")
    .min(1, "Team numbers are digits only, 1 to 99999.")
    .max(99999, "Team numbers are digits only, 1 to 99999."),
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
/**
 * Turn a Postgres grant failure into a sentence an operator can act on.
 *
 * `MARKETING_DATABASE_URL` has to connect as `vantage_marketing`, the only
 * role `0001_roles_and_rls.sql` grants `waitlist_signups` to. Point it at the
 * product app role by mistake — which is what the CI workflow and every local
 * env copied from it do — and the admin console answers
 * `permission denied for table waitlist_signups`, a database's words for a
 * configuration mistake, shown to a person who was looking at a list of names.
 *
 * Nothing here papers over the failure; it stays a failure, and now it says
 * which variable is wrong and what it should hold.
 */
function describeWaitlistDbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission denied for (?:table|relation) waitlist_signups/i.test(message)) {
    return new Error(
      "MARKETING_DATABASE_URL is connected as a role that cannot read waitlist_signups. " +
        "It must use the vantage_marketing role — the product app role is not granted this table.",
    );
  }
  if (/relation "?waitlist_signups"? does not exist/i.test(message)) {
    return new Error(
      "MARKETING_DATABASE_URL points at a database with no waitlist_signups table. " +
        "Run the migrations against it, or unset the variable to use the in-memory store.",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export class NeonWaitlistStore implements WaitlistStore {
  constructor(private readonly url: string) {}

  private rawPool() {
    waitlistPool ??= createSqlPool(this.url);
    return waitlistPool;
  }

  /**
   * The pool every method already used, with its `query` wrapped so no path
   * can lose the hint — adding a method later cannot forget to translate.
   */
  private pool() {
    const pool = this.rawPool();
    const query = pool.query.bind(pool);
    return {
      query: async (...args: Parameters<typeof query>) => {
        try {
          return await query(...args);
        } catch (error) {
          throw describeWaitlistDbError(error);
        }
      },
    } as unknown as ReturnType<typeof createSqlPool>;
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
  // Playwright's next.dev child has E2E_AUTH_FIXTURE and a product
  // vantage_ci URL. That URL is not a marketing database — do not INSERT
  // waitlist rows there (it 500s the public form).
  if (process.env.E2E_AUTH_FIXTURE === "1") return "memory";
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

