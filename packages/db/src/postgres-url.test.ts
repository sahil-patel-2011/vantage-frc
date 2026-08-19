import { describe, expect, it } from "vitest";
import {
  assertSafePostgresUrl,
  connectionHost,
  firstConfiguredEnv,
  poolLimitsForUrl,
  postgresHostKind,
  postgresUsernameLooksLikeSuperuser,
  resolveAppDatabaseUrl,
  shouldUseNodePostgres,
  sslOptionForUrl,
  UnsafePostgresUrlError,
} from "./postgres-url";

describe("postgres host detection", () => {
  it("classifies Neon, Supabase, and local URLs", () => {
    expect(postgresHostKind("postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb")).toBe("neon");
    expect(postgresHostKind("postgresql://postgres.abc:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(
      "supabase",
    );
    expect(postgresHostKind("postgresql://vantage:local@localhost:5432/vantage")).toBe("local");
    expect(connectionHost("postgresql://u:p@db.abcdefghijkl.supabase.co:5432/postgres")).toBe(
      "db.abcdefghijkl.supabase.co",
    );
  });

  it("uses node-postgres for Supabase so SET LOCAL RLS is not bound to the Neon websocket driver", () => {
    const previous = process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_DRIVER;
    try {
      expect(
        shouldUseNodePostgres("postgresql://postgres.abc:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"),
      ).toBe(true);
      expect(shouldUseNodePostgres("postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb")).toBe(false);
      expect(sslOptionForUrl("postgresql://vantage:local@127.0.0.1:5432/vantage")).toBe(false);
    } finally {
      if (previous == null) delete process.env.DATABASE_DRIVER;
      else process.env.DATABASE_DRIVER = previous;
    }
  });

  it("accepts Vercel POSTGRES_URL as a DATABASE_URL fallback and rejects Data API keys", () => {
    const previous = {
      database: process.env.DATABASE_URL,
      postgres: process.env.POSTGRES_URL,
    };
    const supabaseUrl = "postgresql://postgres.abc:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = supabaseUrl;
    try {
      expect(firstConfiguredEnv("DATABASE_URL", "POSTGRES_URL")).toContain("pooler.supabase.com");
      expect(resolveAppDatabaseUrl()).toContain("pooler.supabase.com");
      expect(poolLimitsForUrl(supabaseUrl)).toEqual({ max: 3, idleTimeoutMillis: 10_000 });
      expect(postgresUsernameLooksLikeSuperuser(supabaseUrl)).toBe(true);
      expect(() => assertSafePostgresUrl(supabaseUrl)).not.toThrow();
      expect(() => assertSafePostgresUrl("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig")).toThrow(
        UnsafePostgresUrlError,
      );
      expect(() => assertSafePostgresUrl("https://abcdefghijkl.supabase.co/rest/v1")).toThrow(UnsafePostgresUrlError);
    } finally {
      if (previous.database == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.postgres == null) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = previous.postgres;
    }
  });
});
