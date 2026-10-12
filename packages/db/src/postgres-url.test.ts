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
  databaseSslCa,
  connectionStringForSsl,
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
      // A plain local Postgres must not get the Neon websocket driver: it would fail
      // every query before the server sees it, so nothing lands in the Postgres log.
      expect(shouldUseNodePostgres("postgresql://vantage:local@127.0.0.1:3412/vantage")).toBe(true);
      expect(shouldUseNodePostgres("postgresql://vantage:local@localhost:5432/vantage")).toBe(true);
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
      expect(poolLimitsForUrl("postgresql://vantage:local@localhost:5432/vantage")).toEqual({
        max: 8,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 3_000,
      });
      expect(postgresUsernameLooksLikeSuperuser(supabaseUrl)).toBe(true);
      expect(() => assertSafePostgresUrl(supabaseUrl)).not.toThrow();
      expect(() => assertSafePostgresUrl("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig")).toThrow(
        UnsafePostgresUrlError,
      );
      expect(() => assertSafePostgresUrl("sb_secret_0123456789abcdef0123456789abcdef")).toThrow(
        UnsafePostgresUrlError,
      );
      expect(() => assertSafePostgresUrl("sb_publishable_0123456789abcdef")).toThrow(UnsafePostgresUrlError);
      expect(() => assertSafePostgresUrl("https://abcdefghijkl.supabase.co/rest/v1")).toThrow(UnsafePostgresUrlError);
      process.env.DATABASE_URL = "[SENSITIVE]";
      expect(firstConfiguredEnv("DATABASE_URL", "POSTGRES_URL")).toContain("pooler.supabase.com");
    } finally {
      if (previous.database == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.postgres == null) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = previous.postgres;
    }
  });

  it("verifies a self-hosted server against its own CA, never by turning verification off", () => {
    const previous = process.env.DATABASE_SSL_CA;
    const pem = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
    try {
      delete process.env.DATABASE_SSL_CA;
      expect(sslOptionForUrl("postgresql://vantage:p@nas.example.org:5432/vantage")).toEqual({ rejectUnauthorized: true });
      process.env.DATABASE_SSL_CA = pem;
      expect(sslOptionForUrl("postgresql://vantage:p@nas.example.org:5432/vantage")).toEqual({ rejectUnauthorized: true, ca: pem });
      process.env.DATABASE_SSL_CA = Buffer.from(pem).toString("base64");
      expect(databaseSslCa()).toBe(pem);
      process.env.DATABASE_SSL_CA = "not a certificate";
      expect(databaseSslCa()).toBeNull();
      expect(sslOptionForUrl("postgresql://vantage:p@nas.example.org:5432/vantage?sslmode=disable")).toBe(false);
    } finally {
      if (previous == null) delete process.env.DATABASE_SSL_CA;
      else process.env.DATABASE_SSL_CA = previous;
    }
  });

  it("keeps self-hosted pools small and quick to give up when the server is unreachable", () => {
    expect(poolLimitsForUrl("postgresql://vantage_app:p@nas.example.org:5432/vantage")).toEqual({
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("drops sslmode from the URL when a CA is set, because node-postgres would let it replace the CA", () => {
    const previous = process.env.DATABASE_SSL_CA;
    const nas = "postgresql://vantage_app:p%40ss@nas.example.org:5432/vantage?sslmode=require&application_name=vantage";
    try {
      delete process.env.DATABASE_SSL_CA;
      expect(connectionStringForSsl(nas)).toBe(nas);
      process.env.DATABASE_SSL_CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
      expect(connectionStringForSsl(nas)).toBe(
        "postgresql://vantage_app:p%40ss@nas.example.org:5432/vantage?application_name=vantage",
      );
      // Off stays off, and a laptop URL is never touched.
      const off = "postgresql://vantage:p@nas.example.org:5432/vantage?sslmode=disable";
      expect(connectionStringForSsl(off)).toBe(off);
      expect(connectionStringForSsl("postgresql://v:p@localhost:5432/v?sslmode=require")).toBe(
        "postgresql://v:p@localhost:5432/v?sslmode=require",
      );
    } finally {
      if (previous == null) delete process.env.DATABASE_SSL_CA;
      else process.env.DATABASE_SSL_CA = previous;
    }
  });
});

describe("Supabase pooler mode", () => {
  const session = "postgresql://vantage_app.ref:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres";

  it("sends request pools through the transaction port", async () => {
    const { pooledConnectionString } = await import("./postgres-url");
    expect(pooledConnectionString(session)).toBe(
      "postgresql://vantage_app.ref:pw@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
    );
  });

  it("keeps the session port when a pool asks for it or the operator turns it off", async () => {
    const { pooledConnectionString } = await import("./postgres-url");
    expect(pooledConnectionString(session, "session")).toBe(session);
    const previous = process.env.DATABASE_POOL_MODE;
    process.env.DATABASE_POOL_MODE = "session";
    try {
      expect(pooledConnectionString(session)).toBe(session);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_POOL_MODE;
      else process.env.DATABASE_POOL_MODE = previous;
    }
  });

  it("leaves every other host alone", async () => {
    const { pooledConnectionString } = await import("./postgres-url");
    for (const url of [
      "postgresql://postgres:pw@db.ref.supabase.co:5432/postgres",
      "postgresql://u:pw@ep-x.us-east-2.aws.neon.tech/neondb",
      "postgres://u:pw@localhost:5432/vantage",
      "postgres://u:pw@nas.local:5432/vantage",
      "postgresql://vantage_app.ref:pw@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
    ]) {
      expect(pooledConnectionString(url)).toBe(url);
    }
  });
});
