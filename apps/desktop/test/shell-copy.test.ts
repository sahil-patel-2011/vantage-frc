import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCTION_ORIGIN, isLoopbackOrigin, sanitizeAppOrigin } from "../src/allowlist";
import {
  GATE_UNSUPPORTED_BODY,
  GATE_UNSUPPORTED_TITLE,
  NET_ERR,
  OFFLINE_COPY,
  OFFLINE_HINT,
  OFFLINE_RETRY,
  UPDATE_COPY,
  UPDATE_PORTABLE_NOTE,
  UPDATE_SAFETY,
  UPDATE_STATUS_UNAVAILABLE_BODY,
  UPDATE_STATUS_UNAVAILABLE_TITLE,
  offlineCopy,
  offlineReasonFromLoadError,
  parseOfflineReason,
  studentUpdateError,
} from "../src/shell-copy";

const DESKTOP = join(__dirname, "..");

function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SHELL_LEAK =
  /desktop shell|hosted workspace|Electron|Chromium|VANTAGE_URL|vercel\.app|NSIS|\bsign-in bridge\b|update service|View\s*→\s*Reload|allowlist|preload|partition|sha256|Better Auth|\bERR_|digest mismatch|portable \.exe|file:\/\//i;

describe("VANTAGE_URL / production host", () => {
  it("loads production when VANTAGE_URL is missing or hostile", () => {
    expect(sanitizeAppOrigin(undefined)).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("")).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("   ")).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("https://phish.example")).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("https://random.vercel.app")).toBe(DEFAULT_PRODUCTION_ORIGIN);
  });

  it("loads a loopback mentor override and strips a path", () => {
    expect(sanitizeAppOrigin("http://localhost:3001")).toBe("http://localhost:3001");
    expect(sanitizeAppOrigin("http://127.0.0.1:3001/extra")).toBe("http://127.0.0.1:3001");
    expect(isLoopbackOrigin("http://localhost:3001")).toBe(true);
    expect(isLoopbackOrigin(DEFAULT_PRODUCTION_ORIGIN)).toBe(false);
  });
});

describe("offline load-error mapping", () => {
  it("maps Chromium codes to student reasons", () => {
    expect(offlineReasonFromLoadError(NET_ERR.INTERNET_DISCONNECTED, DEFAULT_PRODUCTION_ORIGIN)).toBe("offline");
    expect(offlineReasonFromLoadError(NET_ERR.NETWORK_ACCESS_DENIED, DEFAULT_PRODUCTION_ORIGIN)).toBe("offline");
    expect(offlineReasonFromLoadError(NET_ERR.NETWORK_CHANGED, DEFAULT_PRODUCTION_ORIGIN)).toBe("offline");
    expect(offlineReasonFromLoadError(NET_ERR.TIMED_OUT, DEFAULT_PRODUCTION_ORIGIN)).toBe("timeout");
    expect(offlineReasonFromLoadError(NET_ERR.CONNECTION_TIMED_OUT, DEFAULT_PRODUCTION_ORIGIN)).toBe("timeout");
    expect(offlineReasonFromLoadError(NET_ERR.CONNECTION_REFUSED, "http://localhost:3001")).toBe("local");
    expect(offlineReasonFromLoadError(NET_ERR.CONNECTION_REFUSED, DEFAULT_PRODUCTION_ORIGIN)).toBe("unreachable");
    expect(offlineReasonFromLoadError(NET_ERR.NAME_NOT_RESOLVED, DEFAULT_PRODUCTION_ORIGIN)).toBe("unreachable");
    expect(offlineReasonFromLoadError(NET_ERR.ABORTED, DEFAULT_PRODUCTION_ORIGIN)).toBe("unreachable");
  });

  it("ignores a hostile reason query and still has copy a student can act on", () => {
    expect(parseOfflineReason("javascript:alert(1)")).toBe("unreachable");
    expect(parseOfflineReason(undefined)).toBe("unreachable");
    const copy = offlineCopy(parseOfflineReason("offline"));
    expect(copy.title).toBe("You're offline");
    expect(copy.body).toMatch(/Wi-Fi/i);
    expect(copy.retry).toBe(OFFLINE_RETRY);
    expect(copy.hint).toBe(OFFLINE_HINT);
  });
});

describe("student update errors", () => {
  it("never passes Node / digest messages through to the window", () => {
    expect(studentUpdateError("digest mismatch")).toMatch(/didn't look right/i);
    expect(studentUpdateError("installer too large")).toMatch(/too big/i);
    expect(studentUpdateError("404")).toMatch(/connection/i);
    expect(studentUpdateError("getaddrinfo ENOTFOUND github.com")).toMatch(/connection/i);
    expect(studentUpdateError("spawn UNKNOWN")).toMatch(/could not be installed/i);
    expect(studentUpdateError(null)).toBeNull();
    expect(studentUpdateError("")).toBeNull();
    expect(studentUpdateError("digest mismatch")).not.toMatch(/digest|sha256|spawn/i);
  });
});

describe("bundled shell pages", () => {
  const offline = readFileSync(join(DESKTOP, "offline.html"), "utf8");
  const gate = readFileSync(join(DESKTOP, "gate.html"), "utf8");
  const update = readFileSync(join(DESKTOP, "update.html"), "utf8");

  it("keeps offline copy in the page and matches the TypeScript source", () => {
    for (const copy of Object.values(OFFLINE_COPY)) {
      expect(offline).toContain(copy.title);
      expect(offline).toContain(copy.body);
    }
    expect(offline).toContain(OFFLINE_RETRY);
    expect(offline).toContain(OFFLINE_HINT);
    expect(offline).toContain("vantageDesktop");
    expect(offline).toMatch(/api\.retry/);
    expect(readFileSync(join(DESKTOP, "src/preload.ts"), "utf8")).toContain("desktop-shell:retry");
  });

  it("does not print a host, menu path, or engineering vocabulary in the offline window", () => {
    const visible = visibleText(offline);
    expect(visible).not.toMatch(SHELL_LEAK);
    expect(visible).not.toMatch(/vantage-frc-web/i);
    expect(visible).not.toMatch(/code>/);
    expect(visible).toMatch(/Can't reach Vantage|You're offline/);
  });

  it("asks a student to download a new copy when sign-in is missing, not a bridge", () => {
    expect(gate).toContain(GATE_UNSUPPORTED_TITLE);
    expect(gate).toContain(GATE_UNSUPPORTED_BODY);
    expect(visibleText(gate)).not.toMatch(SHELL_LEAK);
    expect(gate).not.toMatch(/sign-in bridge/i);
  });

  it("keeps update copy student-readable and in the page", () => {
    expect(update).toContain(UPDATE_COPY.none.title);
    expect(update).toContain(UPDATE_COPY.none.body);
    expect(update).toContain(UPDATE_COPY.required.body);
    expect(update).toContain(UPDATE_COPY.overdue.body);
    expect(update).toContain(UPDATE_COPY.optional.body);
    expect(update).toContain(UPDATE_STATUS_UNAVAILABLE_TITLE);
    expect(update).toContain(UPDATE_STATUS_UNAVAILABLE_BODY);
    expect(update).toContain(UPDATE_PORTABLE_NOTE);
    expect(visibleText(update)).toContain(UPDATE_SAFETY);
    expect(visibleText(update)).not.toMatch(SHELL_LEAK);
    expect(update).not.toMatch(/portable build/i);
    expect(update).not.toMatch(/Last attempt:/);
  });
});
