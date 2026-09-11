import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const MAP_URL = pathToFileURL(resolve("scripts/map-neon-env.mjs")).href;
const PREFLIGHT_URL = pathToFileURL(resolve("scripts/neon-preflight.mjs")).href;
const INVOKE_EXPORT = `
  const module = await import(process.argv[1]);
  const args = JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
  const value = module[process.argv[2]](...args);
  process.stdout.write(JSON.stringify(value));
`;

function invokeExport<T>(moduleUrl: string, name: string, args: unknown[]): T {
  const payload = Buffer.from(JSON.stringify(args)).toString("base64");
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", INVOKE_EXPORT, moduleUrl, name, payload],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as T;
}

const POOLED = "postgresql://vantage_app:super-secret-pass@ep-demo-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT = "postgresql://vantage_worker:super-secret-pass@ep-demo.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("map-neon-env", () => {
  it("maps pooled and unpooled Neon URLs onto the real DATABASE_* aliases", () => {
    const mapped = invokeExport<{
      aliases: Record<string, string>;
      errors: string[];
      warnings: string[];
    }>(MAP_URL, "mapNeonAliases", [
      {
        DATABASE_URL: POOLED,
        DATABASE_URL_UNPOOLED: DIRECT,
      },
    ]);
    expect(mapped.errors).toEqual([]);
    expect(mapped.aliases.DATABASE_URL).toBe(POOLED);
    expect(mapped.aliases.DATABASE_AUTH_URL).toBe(POOLED);
    expect(mapped.aliases.DATABASE_ADMIN_URL).toBe(DIRECT);
    expect(mapped.aliases.MARKETING_DATABASE_URL).toBe(POOLED);
  });

  it("describes a URL without the password", () => {
    const described = invokeExport<string>(MAP_URL, "describeUrl", [POOLED]);
    expect(described).toContain("ep-demo-pooler.us-east-1.aws.neon.tech");
    expect(described).toContain("vantage_app");
    expect(described).not.toContain("super-secret-pass");
  });

  it("refuses JWT / Data API values", () => {
    const mapped = invokeExport<{ errors: string[] }>(MAP_URL, "mapNeonAliases", [
      { DATABASE_URL: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig" },
    ]);
    expect(mapped.errors.some((error) => error.includes("jwt"))).toBe(true);
  });

  it("--print is secret-safe and does not write files", () => {
    const output = execFileSync(process.execPath, ["scripts/map-neon-env.mjs", "--print"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: POOLED,
        DATABASE_AUTH_URL: POOLED,
        DATABASE_ADMIN_URL: DIRECT,
        DATABASE_URL_UNPOOLED: DIRECT,
        MARKETING_DATABASE_URL: POOLED,
        DATABASE_BILLING_URL: POOLED,
        DATABASE_DISPLAY_URL: POOLED,
        DATABASE_ALLIANCE_BOARD_URL: POOLED,
        DATABASE_CAD_RELAY_URL: POOLED,
        POSTGRES_URL: "",
        POSTGRES_URL_NON_POOLING: "",
      },
    });
    expect(output).toContain("DATABASE_URL pooled neon");
    expect(output).toContain("DATABASE_ADMIN_URL direct neon");
    expect(output).not.toContain("super-secret-pass");
    expect(output).not.toContain("ALIASES_WRITTEN");
  });
});

describe("neon-preflight", () => {
  it("PASS/FAIL shape lines name the real env vars and stay secret-safe", () => {
    const result = invokeExport<{
      rows: Array<{ status: string; name: string; detail: string }>;
      urls: Record<string, string>;
    }>(PREFLIGHT_URL, "checkNeonEnvShape", [
      {
        DATABASE_URL: POOLED,
        DATABASE_AUTH_URL: POOLED,
        DATABASE_ADMIN_URL: DIRECT,
        MARKETING_DATABASE_URL: POOLED,
      },
    ]);
    expect(result.rows.find((row) => row.name === "DATABASE_URL shape")?.status).toBe("PASS");
    expect(result.rows.find((row) => row.name === "DATABASE_ADMIN_URL shape")?.status).toBe("PASS");
    expect(result.rows.find((row) => row.name === "host")?.status).toBe("PASS");
    expect(result.rows.some((row) => row.detail.includes("super-secret-pass"))).toBe(false);
  });

  it("fails closed when DATABASE_URL is missing", () => {
    const result = invokeExport<{ rows: Array<{ status: string; name: string }> }>(
      PREFLIGHT_URL,
      "checkNeonEnvShape",
      [{}],
    );
    expect(result.rows.find((row) => row.name === "DATABASE_URL configured")?.status).toBe("FAIL");
  });

  it("--env-only subprocess never prints the password and exits 0 on a valid Neon pair", () => {
    const output = execFileSync(process.execPath, ["scripts/neon-preflight.mjs", "--env-only"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: POOLED,
        DATABASE_AUTH_URL: POOLED,
        DATABASE_ADMIN_URL: DIRECT,
        MARKETING_DATABASE_URL: POOLED,
      },
    });
    expect(output).toContain("PASS");
    expect(output).toContain("RESULT: all hard checks passed");
    expect(output).not.toContain("super-secret-pass");
  });
});

describe("Neon OSS program evidence in-tree", () => {
  it("has an MIT LICENSE at the repo root referenced from README", () => {
    const license = readFileSync("LICENSE", "utf8");
    expect(license.startsWith("MIT License")).toBe(true);
    expect(license).toContain("Permission is hereby granted");
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toMatch(/\[MIT(?: License)?\]\(LICENSE\)|MIT License/);
    expect(readme).toContain("docs/NEON.md");
    expect(readme).toContain("CONTRIBUTING.md");
  });

  it("documents the real Neon env names and migrate/preflight commands", () => {
    const neon = readFileSync("docs/NEON.md", "utf8");
    for (const token of [
      "DATABASE_URL",
      "DATABASE_AUTH_URL",
      "DATABASE_ADMIN_URL",
      "MARKETING_DATABASE_URL",
      "npm run db:migrate",
      "scripts/run-migrations.mjs",
      "scripts/map-neon-env.mjs",
      "npm run db:neon-preflight",
      "withRls",
      "vantage_app",
      "vantage_worker",
    ]) {
      expect(neon).toContain(token);
    }
    expect(neon).toContain("We do not ship Neon-only extensions");
    expect(neon).toContain("does not call the Neon Branches API");
  });

  it("has contributor templates a new clone can follow without asking", () => {
    expect(readFileSync("CONTRIBUTING.md", "utf8")).toContain("docs/NEON.md");
    expect(readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8")).toContain("withRls");
    expect(readFileSync(".github/ISSUE_TEMPLATE/bug.yml", "utf8")).toContain("Neon");
    expect(readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8")).toContain("docs/NEON.md");
    expect(readFileSync("CODE_OF_CONDUCT.md", "utf8")).toContain("Contributor Covenant");
    expect(readFileSync("SECURITY.md", "utf8")).toContain("withRls");
  });
});
