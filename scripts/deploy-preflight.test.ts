import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Row = { status: "PASS" | "WARN" | "FAIL" | "INFO"; name: string; note: string };
type MigrationCheck = {
  rows: Row[];
  duplicates: Array<{ number: string; files: string[] }>;
  gaps: string[];
};

const PREFLIGHT_URL = pathToFileURL(resolve("scripts/deploy-preflight.mjs")).href;
const INVOKE_EXPORT = `
  const module = await import(process.argv[1]);
  const args = JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
  process.stdout.write(JSON.stringify(module[process.argv[2]](...args)));
`;

function invokeExport<T>(name: string, args: unknown[]): T {
  const payload = Buffer.from(JSON.stringify(args)).toString("base64");
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", INVOKE_EXPORT, PREFLIGHT_URL, name, payload],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as T;
}

// Keep the production preflight zero-dependency; execute its exports in Node
// because Vite does not reliably transform this Windows CRLF .mjs file.
const parseEnvFile = (text: string): Record<string, string> =>
  invokeExport("parseEnvFile", [text]);
const checkEnv = (env: Record<string, string>): Row[] => invokeExport("checkEnv", [env]);
const checkMigrations = (files: string[]): MigrationCheck =>
  invokeExport("checkMigrations", [files]);
const summarize = (rows: Row[]): Record<string, number> => invokeExport("summarize", [rows]);

describe("parseEnvFile", () => {
  it("parses key=value, strips quotes, skips comments and blanks", () => {
    const env = parseEnvFile('A=1\n# comment\n\nB="two"\nC=\'three\'\nNOEQUALS\nD=a=b');
    expect(env).toEqual({ A: "1", B: "two", C: "three", D: "a=b" });
  });
});

describe("checkEnv", () => {
  it("fails on missing required vars and names what breaks", () => {
    const rows: Row[] = checkEnv({});
    const dbRow = rows.find((row) => row.name === "DATABASE_URL");
    expect(dbRow?.status).toBe("FAIL");
    expect(dbRow?.note).toContain("setup_required");
  });

  it("passes required vars via documented integration aliases", () => {
    const rows: Row[] = checkEnv({
      POSTGRES_URL: "postgres://pooled",
      POSTGRES_URL_NON_POOLING: "postgres://direct",
    });
    expect(rows.find((row) => row.name === "DATABASE_URL")?.status).toBe("PASS");
    expect(rows.find((row) => row.name === "DATABASE_ADMIN_URL")?.status).toBe("PASS");
    expect(rows.find((row) => row.name === "DATABASE_AUTH_URL")?.status).toBe("PASS");
  });

  it("treats whitespace-only values as missing", () => {
    const rows: Row[] = checkEnv({ CRON_SECRET: "   " });
    expect(rows.find((row) => row.name === "CRON_SECRET")?.status).toBe("FAIL");
  });

  it("flags dev-only vars that must not reach production", () => {
    const rows: Row[] = checkEnv({ E2E_AUTH_FIXTURE: "user@example.com", BOOTSTRAP_TOKEN: "t" });
    expect(rows.find((row) => row.name === "E2E_AUTH_FIXTURE")?.status).toBe("FAIL");
    expect(rows.find((row) => row.name === "BOOTSTRAP_TOKEN")?.status).toBe("WARN");
  });

  it("warns on a partial platform-owner bootstrap trio", () => {
    const rows: Row[] = checkEnv({ PLATFORM_OWNER_EMAIL: "owner@example.com" });
    expect(rows.some((row) => row.status === "WARN" && row.note.includes("platform-owner"))).toBe(true);
  });
});

describe("checkMigrations", () => {
  it("passes a clean sequential set", () => {
    const { rows, duplicates, gaps } = checkMigrations(["0000_a.sql", "0001_b.sql", "0002_c.sql"]);
    expect(duplicates).toEqual([]);
    expect(gaps).toEqual([]);
    expect(rows.every((row: Row) => row.status === "PASS")).toBe(true);
  });

  it("fails a new duplicate number prefix", () => {
    const { rows, duplicates } = checkMigrations(["0000_a.sql", "0001_b.sql", "0001_c.sql"]);
    expect(duplicates).toEqual([{ number: "0001", files: ["0001_b.sql", "0001_c.sql"] }]);
    const failure = rows.find((row: Row) => row.name === "prefix 0001");
    expect(failure?.status).toBe("FAIL");
    expect(failure?.note).toContain("NEW duplicate");
  });

  it("warns only for the exact frozen historical collision", () => {
    const frozen = ["0050_driver_practice.sql", "0050_safety_log.sql"];
    const { rows } = checkMigrations(frozen);
    expect(rows.find((row: Row) => row.name === "prefix 0050")?.status).toBe("WARN");

    const withNewFile = checkMigrations([...frozen, "0050_third.sql"]).rows;
    expect(withNewFile.find((row: Row) => row.name === "prefix 0050")?.status).toBe("FAIL");
  });

  it("reports numbering gaps without failing", () => {
    const { rows, gaps } = checkMigrations(["0000_a.sql", "0002_b.sql"]);
    expect(gaps).toEqual(["0000 -> 0002"]);
    expect(rows.some((row: Row) => row.status === "FAIL")).toBe(false);
  });

  it("fails malformed filenames and ignores non-sql files", () => {
    const { rows } = checkMigrations(["0000_a.sql", "notes.txt", "extra.sql"]);
    const bad = rows.find((row: Row) => row.name === "extra.sql");
    expect(bad?.status).toBe("FAIL");
    expect(rows.some((row: Row) => row.name === "notes.txt")).toBe(false);
  });

  it("flags a set that does not start at 0000", () => {
    const { gaps } = checkMigrations(["0001_a.sql", "0002_b.sql"]);
    expect(gaps[0]).toContain("starts at 0001");
  });
});

describe("summarize", () => {
  it("counts by status", () => {
    const counts = summarize([
      { status: "PASS", name: "a", note: "" },
      { status: "WARN", name: "b", note: "" },
      { status: "FAIL", name: "c", note: "" },
      { status: "PASS", name: "d", note: "" },
    ]);
    expect(counts).toEqual({ PASS: 2, WARN: 1, FAIL: 1, INFO: 0 });
  });
});
