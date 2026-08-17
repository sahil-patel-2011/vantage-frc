import { describe, expect, it } from "vitest";
import {
  connectionHost,
  postgresHostKind,
  shouldUseNodePostgres,
  sslOptionForUrl,
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
});
