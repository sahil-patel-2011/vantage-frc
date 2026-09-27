import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Row = { name: string; status: string; note: string };
function settings(env: Record<string, string>): Row[] {
  const url = pathToFileURL(path.resolve("scripts/release-preflight.mjs")).href;
  const input = Buffer.from(JSON.stringify(env)).toString("base64");
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", 'const m=await import(process.argv[1]); console.log(JSON.stringify(m.checkReleaseSettings(JSON.parse(Buffer.from(process.argv[2],"base64").toString("utf8")))));', url, input], { encoding: "utf8" }));
}
describe("production release settings", () => {
  it("accepts either supported email provider but requires a complete, readable pair", () => {
    const status = (env: Record<string, string>) => settings(env).find(row => row.name === "EMAIL_DELIVERY")?.status;
    expect(status({ GMAIL_SMTP_USER: "operator@gmail.com", GMAIL_SMTP_APP_PASSWORD: "local-fixture-only" })).toBe("PASS");
    expect(status({ RESEND_KEY: "local-fixture-only", EMAIL_FROM: "Vantage <team@example.org>" })).toBe("PASS");
    expect(status({ GMAIL_SMTP_USER: "[SENSITIVE]", GMAIL_SMTP_APP_PASSWORD: "[SENSITIVE]" })).toBe("UNVERIFIED");
    expect(status({ GMAIL_SMTP_USER: "operator@gmail.com" })).toBe("FAIL");
    expect(status({ RESEND_API_KEY: "local-fixture-only", AUTH_EMAIL_FROM: "operator@gmail.com" })).toBe("FAIL");
    expect(status({ RESEND_API_KEY: "[SENSITIVE]", AUTH_EMAIL_FROM: "[SENSITIVE]" })).toBe("UNVERIFIED");
  });
  it("does not accept development fallbacks or protected placeholders as proof", () => {
    const rows = settings({ DATABASE_URL: "postgresql://owner@localhost/test", DATABASE_AUTH_URL: "[SENSITIVE]", DATABASE_ADMIN_URL: "postgresql://owner@localhost/test" });
    expect(rows.find((row) => row.name === "DATABASE_AUTH_URL")?.status).toBe("UNVERIFIED");
    expect(rows.find((row) => row.name === "DATABASE_WORKER_URL")?.status).toBe("FAIL");
    expect(rows.find((row) => row.name === "DATABASE_AI_BRIDGE_URL")?.status).toBe("FAIL");
  });
  it("requires actual key sizes, secure origins and signed private Google access", () => {
    const rows = settings({ RECOVERY_ENCRYPTION_KEY: "wrong", EXPORT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), BETTER_AUTH_URL: "http://localhost", VANTAGE_SHEETS_HUB_SECRET: "a".repeat(64), VANTAGE_SHEETS_HUB_SHARE: "1" });
    expect(rows.find((row) => row.name === "RECOVERY_ENCRYPTION_KEY")?.status).toBe("FAIL");
    expect(rows.find((row) => row.name === "EXPORT_ENCRYPTION_KEY")?.status).toBe("PASS");
    expect(rows.find((row) => row.name === "BETTER_AUTH_URL")?.status).toBe("FAIL");
    expect(rows.find((row) => row.name === "VANTAGE_SHEETS_HUB_SECRET")?.status).toBe("PASS");
    expect(rows.find((row) => row.name === "VANTAGE_SHEETS_HUB_SHARE")?.status).toBe("FAIL");
  });
  it("rejects premature signup and authentication bypasses without exposing values", () => {
    const sensitive = "private-fixture-secret";
    const rows = settings({ VANTAGE_PUBLIC_SIGNUP: "open", DEV_OTP_SECRET: sensitive, ENABLE_EMAIL_2FA_BYPASS: "1" });
    expect(rows.filter((row) => ["VANTAGE_PUBLIC_SIGNUP", "DEV_OTP_SECRET", "ENABLE_EMAIL_2FA_BYPASS"].includes(row.name)).every((row) => row.status === "FAIL")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(sensitive);
  });
});
