import { describe, expect, it } from "vitest";
import { BackupModeError } from "@vantage/db/backup-mode";
import { classifyDatabaseFailure, isDatabaseFailure, maskHost, scrubMessage } from "./classify";

/** A Node system error the way `net.connect` produces one. */
function systemError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`connect ${code} 203.0.113.9:5432`), { code, errno: -1, syscall: "connect", ...extra });
}

/** A node-postgres DatabaseError: the server's own answer, with its SQLSTATE. */
function pgError(code: string, message = "server error") {
  return Object.assign(new Error(message), { code, severity: "FATAL" });
}

describe("classifyDatabaseFailure", () => {
  it("backup mode: disconnected on purpose, says how to turn it off, and counts as unavailable", () => {
    const result = classifyDatabaseFailure(new BackupModeError());
    expect(result).toMatchObject({ code: "backup_mode", errorCode: "VANTAGE_BACKUP_MODE", host: null, detail: null });
    expect(result.fix).toMatch(/remove VANTAGE_BACKUP_MODE/);
    expect(isDatabaseFailure(new BackupModeError())).toBe(true);
  });

  it("ECONNREFUSED: the NAS answers but Postgres isn't listening", () => {
    const result = classifyDatabaseFailure(systemError("ECONNREFUSED", { address: "203.0.113.9", port: 5432 }));
    expect(result.code).toBe("connection_refused");
    expect(result.why).toMatch(/container is stopped/);
    expect(result.errorCode).toBe("ECONNREFUSED");
    expect(result.host).toBe("203.0.*.*:5432");
  });

  it("reads through Node's AggregateError (IPv4 + IPv6 attempts)", () => {
    const aggregate = Object.assign(new AggregateError([systemError("ECONNREFUSED"), systemError("ECONNREFUSED")], ""), {
      code: "ECONNREFUSED",
    });
    expect(classifyDatabaseFailure(aggregate).code).toBe("connection_refused");
  });

  it("refused on loopback in production means no database URL is set", () => {
    const error = systemError("ECONNREFUSED", { address: "127.0.0.1", port: 5432 });
    expect(classifyDatabaseFailure(error, { NODE_ENV: "production" }).code).toBe("not_configured");
    expect(classifyDatabaseFailure(error, { NODE_ENV: "development" }).code).toBe("connection_refused");
  });

  for (const code of ["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]) {
    it(`${code}: the NAS is offline or its internet / port forward is down`, () => {
      const result = classifyDatabaseFailure(systemError(code));
      expect(result.code).toBe("unreachable");
      expect(result.why).toMatch(/internet|port/);
      expect(result.errorCode).toBe(code);
    });
  }

  it("node-postgres connection timeouts count as unreachable", () => {
    const pool = new Error("Connection terminated due to connection timeout", { cause: new Error("Connection terminated") });
    expect(classifyDatabaseFailure(pool).code).toBe("unreachable");
    expect(classifyDatabaseFailure(new Error("timeout exceeded when trying to connect")).code).toBe("unreachable");
    expect(classifyDatabaseFailure(new Error("timeout expired")).code).toBe("unreachable");
  });

  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    it(`${code}: the DDNS name doesn't resolve`, () => {
      const error = Object.assign(new Error(`getaddrinfo ${code} vantage-db.example.ddns.net`), {
        code,
        hostname: "vantage-db.example.ddns.net",
      });
      const result = classifyDatabaseFailure(error);
      expect(result.code).toBe("dns");
      expect(result.why).toMatch(/dynamic DNS/);
      expect(result.host).toBe("va***.example.ddns.net");
    });
  }

  it.each([
    ["CERT_HAS_EXPIRED", /expired/],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", /isn't trusted/],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", /isn't trusted/],
    ["SELF_SIGNED_CERT_IN_CHAIN", /isn't trusted/],
    ["ERR_TLS_CERT_ALTNAME_INVALID", /different name/],
  ])("%s is a certificate problem", (code, title) => {
    const result = classifyDatabaseFailure(Object.assign(new Error("tls failure"), { code }));
    expect(result.code).toBe("tls");
    expect(result.title).toMatch(title);
    expect(`${result.why} ${result.fix}`).toMatch(/certificate|DATABASE_SSL_CA|server\.crt/);
  });

  it("self-signed and hostname messages without a code are certificate problems too", () => {
    expect(classifyDatabaseFailure(new Error("self-signed certificate in certificate chain")).code).toBe("tls");
    expect(classifyDatabaseFailure(new Error("Hostname/IP does not match certificate's altnames")).title).toMatch(/different name/);
    expect(classifyDatabaseFailure(new Error("The server does not support SSL connections")).code).toBe("tls");
    expect(classifyDatabaseFailure(new Error("self signed certificate")).fix).toMatch(/DATABASE_SSL_CA/);
  });

  it.each([
    ["28P01", "auth", 'password authentication failed for user "vantage_app"'],
    ["28000", "auth", "no pg_hba.conf entry"],
    ["53300", "too_many_connections", "sorry, too many clients already"],
    ["53100", "disk_full", "could not extend file: No space left on device"],
    ["25006", "read_only", "cannot execute INSERT in a read-only transaction"],
    ["57P01", "shutting_down", "terminating connection due to administrator command"],
    ["57P03", "starting_up", "the database system is starting up"],
    ["3D000", "database_missing", 'database "vantage" does not exist'],
  ])("SQLSTATE %s → %s", (state, code, message) => {
    const result = classifyDatabaseFailure(pgError(state, message));
    expect(result.code).toBe(code);
    expect(result.errorCode).toBe(`SQLSTATE ${state}`);
  });

  it("recognises read-only and server-state messages that arrive without a code", () => {
    expect(classifyDatabaseFailure(new Error("cannot execute UPDATE in a read-only transaction")).code).toBe("read_only");
    expect(classifyDatabaseFailure(new Error("the database system is shutting down")).code).toBe("shutting_down");
  });

  it("a dropped connection is connection_lost", () => {
    expect(classifyDatabaseFailure(new Error("Connection terminated unexpectedly")).code).toBe("connection_lost");
    expect(classifyDatabaseFailure(systemError("ECONNRESET")).code).toBe("connection_lost");
  });

  it("anything else is unknown, keeps the code, and scrubs the message", () => {
    const error = Object.assign(
      new Error("weird failure at postgresql://vantage_app:hunter2@vantage-db.example.ddns.net:5432/vantage password=hunter2"),
      { code: "EWEIRD" },
    );
    const result = classifyDatabaseFailure(error);
    expect(result.code).toBe("unknown");
    expect(result.errorCode).toBe("EWEIRD");
    expect(result.detail).not.toMatch(/hunter2/);
    expect(result.detail).not.toMatch(/postgresql:\/\//);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|vantage-db\.example/);
  });

  it("never leaks a connection string through any field", () => {
    for (const error of [
      systemError("ECONNREFUSED", { address: "203.0.113.9" }),
      Object.assign(new Error("getaddrinfo ENOTFOUND db.team.ddns.net"), { code: "ENOTFOUND", hostname: "db.team.ddns.net" }),
      new Error("boom postgres://u:secretpw@db.team.ddns.net/vantage"),
    ]) {
      expect(JSON.stringify(classifyDatabaseFailure(error))).not.toMatch(/secretpw|db\.team\.ddns|203\.0\.113\.9/);
    }
  });
});

describe("isDatabaseFailure", () => {
  it("is true for connection, login and server-state failures", () => {
    expect(isDatabaseFailure(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDatabaseFailure(systemError("ECONNREFUSED"))).toBe(true);
    expect(isDatabaseFailure(pgError("28P01"))).toBe(true);
    // Wrapped by an auth library: the cause still counts.
    expect(isDatabaseFailure(new Error("Failed to get session", { cause: systemError("ETIMEDOUT") }))).toBe(true);
  });

  it("is false for bugs, missing sessions and refusals", () => {
    expect(isDatabaseFailure(null)).toBe(false);
    expect(isDatabaseFailure(new Error("auth database unavailable"))).toBe(false);
    expect(isDatabaseFailure(new Error("Authentication required"))).toBe(false);
    expect(isDatabaseFailure(pgError("42P01", 'relation "x" does not exist'))).toBe(false);
    expect(isDatabaseFailure(pgError("42501", "permission denied"))).toBe(false);
    expect(isDatabaseFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});

describe("maskHost / scrubMessage", () => {
  it("masks hosts and keeps loopback readable", () => {
    expect(maskHost("vantage-db.example.ddns.net")).toBe("va***.example.ddns.net");
    expect(maskHost("nas.lan")).toBe("na***.lan");
    expect(maskHost("198.51.100.20")).toBe("198.51.*.*");
    expect(maskHost("2001:db8::1")).toBe("2001:…");
    expect(maskHost("localhost")).toBe("localhost");
    expect(maskHost("")).toBeNull();
  });

  it("removes URLs and secret pairs", () => {
    expect(scrubMessage("x postgres://a:b@c/d token=abc")).toBe("x [connection string removed] token=[removed]");
  });
});
