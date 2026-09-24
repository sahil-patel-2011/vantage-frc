import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HUB_REGISTRATION_MAX_AGE_MS, appsScriptSource, hubRegistrationMessage, isAppsScriptUrl } from "./apps-script-source";
import { sheetsHubConfig, verifyHubRegistration } from "./sheets-hub";

const SECRET = "b".repeat(64);
const EXEC = "https://script.google.com/macros/s/AKfycbx_registration-test-0123456789/exec";
const WORKSPACE_EXEC = "https://script.google.com/a/macros/school.example.org/s/AKfycbx_workspace-test-0123456789/exec";
const NOW = 1_790_000_000_000;

function sign(url: string, ts: number, secret = SECRET): string {
  return createHmac("sha256", secret).update(hubRegistrationMessage(url, ts)).digest("hex");
}

/** Run the hub script's doGet with just the Apps Script services it touches. */
function openScriptPage(appUrl: string | null, execUrl = EXEC) {
  const globals = {
    ScriptApp: { getService: () => ({ getUrl: () => execUrl }) },
    HtmlService: {
      createHtmlOutput: (html: string) => ({ html, title: "", setTitle(title: string) { this.title = title; return this; } }),
    },
    Utilities: {
      computeHmacSha256Signature: (value: string, key: string) =>
        [...createHmac("sha256", key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
  };
  const factory = new Function(...Object.keys(globals), `${appsScriptSource(SECRET, { appUrl })}\nreturn { doGet };`) as (
    ...args: unknown[]
  ) => { doGet: () => { html?: string; title?: string; text?: string } };
  return factory(...Object.values(globals)).doGet();
}

describe("hub registration check", () => {
  it("accepts the script's own address signed with the server secret", () => {
    expect(verifyHubRegistration({ url: EXEC, ts: NOW, sig: sign(EXEC, NOW) }, SECRET, NOW)).toEqual({ ok: true, url: EXEC });
    expect(verifyHubRegistration({ url: EXEC, ts: String(NOW), sig: sign(EXEC, NOW).toUpperCase() }, SECRET.toUpperCase(), NOW + 1000).ok).toBe(true);
  });

  it("accepts a school (Workspace) deployment", () => {
    expect(verifyHubRegistration({ url: WORKSPACE_EXEC, ts: NOW, sig: sign(WORKSPACE_EXEC, NOW) }, SECRET, NOW).ok).toBe(true);
  });

  it("refuses a signature made with another secret", () => {
    const result = verifyHubRegistration({ url: EXEC, ts: NOW, sig: sign(EXEC, NOW, "c".repeat(64)) }, SECRET, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/secret doesn't match/);
  });

  it("refuses a signature for a different address", () => {
    expect(verifyHubRegistration({ url: EXEC, ts: NOW, sig: sign(WORKSPACE_EXEC, NOW) }, SECRET, NOW).ok).toBe(false);
  });

  it("refuses a link older than a day or from the future", () => {
    const old = NOW - HUB_REGISTRATION_MAX_AGE_MS - 1;
    expect(verifyHubRegistration({ url: EXEC, ts: old, sig: sign(EXEC, old) }, SECRET, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/out of date/) });
    const ahead = NOW + 10 * 60 * 1000;
    expect(verifyHubRegistration({ url: EXEC, ts: ahead, sig: sign(EXEC, ahead) }, SECRET, NOW).ok).toBe(false);
    expect(verifyHubRegistration({ url: EXEC, ts: "soon", sig: sign(EXEC, NOW) }, SECRET, NOW).ok).toBe(false);
  });

  it("refuses anything that isn't a deployed /exec address", () => {
    for (const url of [EXEC.replace("/exec", "/dev"), EXEC.replace("https", "http"), "https://evil.example/macros/s/AKfycbx_registration-test-0123456789/exec", ""]) {
      expect(verifyHubRegistration({ url, ts: NOW, sig: sign(url, NOW) }, SECRET, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/deployed web app/) });
    }
  });

  it("refuses when the server has no secret or the body is missing fields", () => {
    expect(verifyHubRegistration({ url: EXEC, ts: NOW, sig: sign(EXEC, NOW) }, undefined, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/no hub secret/) });
    expect(verifyHubRegistration({}, SECRET, NOW).ok).toBe(false);
    expect(verifyHubRegistration({ url: EXEC, ts: NOW }, SECRET, NOW).ok).toBe(false);
  });
});

describe("web app addresses", () => {
  it("knows a real Apps Script address, personal or school", () => {
    expect(isAppsScriptUrl(EXEC)).toBe(true);
    expect(isAppsScriptUrl(WORKSPACE_EXEC)).toBe(true);
    expect(isAppsScriptUrl(`  ${EXEC}  `)).toBe(true);
    expect(isAppsScriptUrl(EXEC.replace("/exec", "/dev"))).toBe(false);
    expect(isAppsScriptUrl("https://script.google.com/a/macros/bad domain/s/AKfycbx_workspace-test-0123456789/exec")).toBe(false);
    expect(isAppsScriptUrl("https://script.google.com.evil.example/macros/s/AKfycbx_registration-test-0123456789/exec")).toBe(false);
  });

  it("uses the registered address unless the server sets one", () => {
    const env = { VANTAGE_SHEETS_HUB_SECRET: SECRET } as NodeJS.ProcessEnv;
    expect(sheetsHubConfig(env, WORKSPACE_EXEC)).toEqual({ url: WORKSPACE_EXEC, secret: SECRET });
    expect(sheetsHubConfig({ ...env, VANTAGE_SHEETS_HUB_URL: EXEC }, WORKSPACE_EXEC)?.url).toBe(EXEC);
    expect(sheetsHubConfig(env, "https://evil.example/exec")).toBeNull();
  });
});

describe("the script's Connect to Vantage page", () => {
  it("links to Admin → Integrations with its own address, signed so the server accepts it", () => {
    const page = openScriptPage("https://vantagefrc.vercel.app");
    expect(page.title).toBe("Connect to Vantage");
    const href = /href="([^"]+)"/.exec(page.html ?? "")?.[1] ?? "";
    const link = new URL(href);
    expect(link.origin + link.pathname).toBe("https://vantagefrc.vercel.app/admin/integrations");
    const input = { url: link.searchParams.get("sheetsHub"), ts: link.searchParams.get("ts"), sig: link.searchParams.get("sig") };
    expect(input.url).toBe(EXEC);
    expect(verifyHubRegistration(input, SECRET, Number(input.ts))).toEqual({ ok: true, url: EXEC });
  });

  it("stays a plain health check in a team's own script", () => {
    const page = openScriptPage(null);
    expect(page.html).toBeUndefined();
    expect(JSON.parse(page.text ?? "{}")).toMatchObject({ ok: true, service: "vantage-sheets-bridge" });
  });

  it("never embeds an address that isn't a plain web origin", () => {
    const page = openScriptPage('https://vantage.example/"><script>');
    expect(page.html).toBeUndefined();
  });
});
