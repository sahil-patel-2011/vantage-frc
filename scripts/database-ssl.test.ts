import { describe, expect, it } from "vitest";
import { databaseSslCa, pgTlsOptions } from "./lib/database-ssl.mjs";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const NAS = "postgresql://vantage_worker:secret@nas.example.org:5432/vantage?sslmode=require";

describe("database TLS for scripts", () => {
  it("reads the CA as PEM text, PEM with literal \\n, or base64", () => {
    expect(databaseSslCa(PEM)).toBe(PEM);
    expect(databaseSslCa(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
    expect(databaseSslCa(Buffer.from(PEM).toString("base64"))).toBe(PEM);
    expect(databaseSslCa("nope")).toBeNull();
    expect(databaseSslCa(undefined)).toBeNull();
  });

  it("verifies against the NAS CA and removes sslmode so it cannot override the CA", () => {
    const options = pgTlsOptions(NAS, { DATABASE_SSL_CA: PEM });
    expect(options.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(options.connectionString).toBe("postgresql://vantage_worker:secret@nas.example.org:5432/vantage");
  });

  it("keeps public-CA hosts verified and leaves local or disabled TLS alone", () => {
    expect(pgTlsOptions(NAS, {})).toEqual({ connectionString: NAS, ssl: { rejectUnauthorized: true } });
    expect(pgTlsOptions("postgresql://v:p@127.0.0.1:5432/v", { DATABASE_SSL_CA: PEM }).ssl).toBe(false);
    expect(pgTlsOptions("postgresql://v:p@nas.example.org/v?sslmode=disable", { DATABASE_SSL_CA: PEM }).ssl).toBe(false);
  });
});
