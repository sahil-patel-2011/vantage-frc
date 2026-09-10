import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { featureCacheKey } from "./feature-cache";
import {
  OFFLINE_SHELL_ROUTES,
  navigationFallbackPath,
  offlineCapableLabel,
  pathnameIsOfflineShell,
  isRscRequest,
} from "./shell-routes";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("offline shell routes", () => {
  it("matches allowlisted product paths and nested scouting", () => {
    expect(pathnameIsOfflineShell("/scouting")).toBe(true);
    expect(pathnameIsOfflineShell("/scouting/lineup")).toBe(true);
    expect(pathnameIsOfflineShell("/calendar")).toBe(true);
    expect(pathnameIsOfflineShell("/team/calendar")).toBe(true);
    expect(pathnameIsOfflineShell("/todos")).toBe(true);
    expect(pathnameIsOfflineShell("/tasks")).toBe(true);
    expect(pathnameIsOfflineShell("/logistics")).toBe(true);
    expect(pathnameIsOfflineShell("/schedule")).toBe(true);
    expect(pathnameIsOfflineShell("/offline-shell")).toBe(true);
    expect(pathnameIsOfflineShell("/offline")).toBe(true);
    expect(pathnameIsOfflineShell("/competition")).toBe(true);
    expect(pathnameIsOfflineShell("/command")).toBe(true);
    expect(pathnameIsOfflineShell("/team")).toBe(true);
    expect(pathnameIsOfflineShell("/dashboard")).toBe(true);
    expect(pathnameIsOfflineShell("/build")).toBe(true);
    expect(pathnameIsOfflineShell("/files")).toBe(true);
    expect(pathnameIsOfflineShell("/docs")).toBe(true);
    expect(pathnameIsOfflineShell("/strategy")).toBe(true);
    expect(pathnameIsOfflineShell("/hours")).toBe(true);
    expect(pathnameIsOfflineShell("/hours/kiosk")).toBe(true);
    expect(pathnameIsOfflineShell("/messages")).toBe(true);
    expect(pathnameIsOfflineShell("/match-checklist")).toBe(true);
    expect(pathnameIsOfflineShell("/match-notes-timeline")).toBe(true);
    expect(pathnameIsOfflineShell("/pit")).toBe(true);
    expect(pathnameIsOfflineShell("/video-analysis")).toBe(true);
    expect(pathnameIsOfflineShell("/assembly-manual")).toBe(true);
    expect(pathnameIsOfflineShell("/packing")).toBe(true);
    expect(pathnameIsOfflineShell("/batteries")).toBe(true);
    expect(pathnameIsOfflineShell("/my-day")).toBe(true);
    expect(pathnameIsOfflineShell("/chemistry")).toBe(true);
    expect(pathnameIsOfflineShell("/pick-clock")).toBe(true);
    expect(pathnameIsOfflineShell("/alliance-selection-desk")).toBe(true);
    expect(pathnameIsOfflineShell("/print-farm")).toBe(true);
    expect(pathnameIsOfflineShell("/inventory")).toBe(true);
    expect(pathnameIsOfflineShell("/api/todos")).toBe(false);
  });

  it("labels offline-capable surfaces for banners", () => {
    expect(offlineCapableLabel("/scouting?orgId=x")).toBe("Scouting");
    expect(offlineCapableLabel("/team/calendar")).toBe("Calendar");
    expect(offlineCapableLabel("/calendar")).toBe("Calendar");
    expect(offlineCapableLabel("/todos")).toBe("Todos");
    expect(offlineCapableLabel("/logistics")).toBe("Logistics");
    expect(offlineCapableLabel("/dashboard")).toBe("Home");
    expect(offlineCapableLabel("/files")).toBe("Files");
    expect(offlineCapableLabel("/hours")).toBe("Hours");
    expect(offlineCapableLabel("/messages")).toBe("Chat");
    expect(offlineCapableLabel("/assembly-manual")).toBe("Assembly manual");
    expect(offlineCapableLabel("/packing")).toBe("Packing");
    expect(offlineCapableLabel("/batteries")).toBe("Batteries");
    expect(offlineCapableLabel("/pit")).toBe("Pit");
    expect(offlineCapableLabel("/my-day")).toBe("My Day");
    expect(offlineCapableLabel("/schedule")).toBe("Schedule");
    expect(offlineCapableLabel("/command")).toBe("Event Day");
    expect(offlineCapableLabel("/chemistry")).toBe("Chemistry");
    expect(offlineCapableLabel("/pick-clock")).toBe("Pick clock");
    expect(offlineCapableLabel("/alliance-selection-desk")).toBe("Alliance selection desk");
    expect(offlineCapableLabel("/print-farm")).toBe("Print Farm");
    expect(offlineCapableLabel("/inventory")).toBe("Inventory");
  });

  it("keeps public/sw.js SHELL_ROUTES aligned with OFFLINE_SHELL_ROUTES", () => {
    const sw = readFileSync(join(WEB_ROOT, "public", "sw.js"), "utf8");
    const block = sw.match(/const SHELL_ROUTES = \[([\s\S]*?)\];/);
    expect(block, "sw.js is missing SHELL_ROUTES").toBeTruthy();
    const routes = [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect([...routes].sort()).toEqual([...OFFLINE_SHELL_ROUTES].sort());
  });

  it("builds stable feature cache keys", () => {
    expect(featureCacheKey("todos", " org-1 ")).toBe("todos:org-1");
    expect(featureCacheKey("logistics", "")).toBe("logistics:_");
    expect(featureCacheKey("files", "org-1", "team:")).toBe("files:org-1:team:");
    expect(featureCacheKey("packing", "org-1")).toBe("packing:org-1");
    expect(featureCacheKey("batteries", "org-1")).toBe("batteries:org-1");
    expect(featureCacheKey("pit", "org-1")).toBe("pit:org-1");
    expect(featureCacheKey("season-tasks", "org-1", "2026")).toBe("season-tasks:org-1:2026");
    expect(featureCacheKey("calendar", "org-1")).toBe("calendar:org-1");
    expect(featureCacheKey("my-day", "org-1")).toBe("my-day:org-1");
    expect(featureCacheKey("dashboard", "org-1")).toBe("dashboard:org-1");
    expect(featureCacheKey("assembly-manual", "org-1")).toBe("assembly-manual:org-1");
    expect(featureCacheKey("chemistry", "org-1")).toBe("chemistry:org-1");
    expect(featureCacheKey("pick-clock", "org-1")).toBe("pick-clock:org-1");
    expect(featureCacheKey("alliance-desk", "org-1", "sess-1")).toBe("alliance-desk:org-1:sess-1");
    expect(featureCacheKey("print-farm", "org-1")).toBe("print-farm:org-1");
    expect(featureCacheKey("inventory", "org-1")).toBe("inventory:org-1");
    expect(featureCacheKey("schedule", "org-1")).toBe("schedule:org-1");
  });

  it("falls failed navigations back to the precached shell", () => {
    expect(navigationFallbackPath()).toBe("/offline");
  });

  it("detects RSC / Flight requests so the SW can bypass them", () => {
    expect(isRscRequest(new Headers({ accept: "text/x-component", RSC: "1" }))).toBe(true);
    expect(isRscRequest(new Headers({ "Next-Router-State-Tree": "%5B%5D" }))).toBe(true);
    expect(isRscRequest(new Headers({ accept: "text/html" }))).toBe(false);
  });
});

