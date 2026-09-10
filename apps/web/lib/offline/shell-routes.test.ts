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
    expect(pathnameIsOfflineShell("/defense-planner")).toBe(true);
    expect(pathnameIsOfflineShell("/picklist-collab")).toBe(true);
    expect(pathnameIsOfflineShell("/dossier")).toBe(true);
    expect(pathnameIsOfflineShell("/pit-repair-triage")).toBe(true);
    expect(pathnameIsOfflineShell("/event-day-plan")).toBe(true);
    expect(pathnameIsOfflineShell("/field-reset-timer")).toBe(true);
    expect(pathnameIsOfflineShell("/drive-team-signals")).toBe(true);
    expect(pathnameIsOfflineShell("/robot-weigh-in")).toBe(true);
    expect(pathnameIsOfflineShell("/match-delta-watcher")).toBe(true);
    expect(pathnameIsOfflineShell("/match-video-index")).toBe(true);
    expect(pathnameIsOfflineShell("/strategy/draft")).toBe(true);
    expect(pathnameIsOfflineShell("/scouting/lineup")).toBe(true);
    expect(pathnameIsOfflineShell("/match-strategy-cards")).toBe(true);
    expect(pathnameIsOfflineShell("/match-copilot")).toBe(true);
    expect(pathnameIsOfflineShell("/event-readiness")).toBe(true);
    expect(pathnameIsOfflineShell("/video")).toBe(true);
    expect(pathnameIsOfflineShell("/inspection-copilot")).toBe(true);
    expect(pathnameIsOfflineShell("/inspection")).toBe(true);
    expect(pathnameIsOfflineShell("/fmea")).toBe(true);
    expect(pathnameIsOfflineShell("/match-sim")).toBe(true);
    expect(pathnameIsOfflineShell("/pit-map-planner")).toBe(true);
    expect(pathnameIsOfflineShell("/pairwise")).toBe(true);
    expect(pathnameIsOfflineShell("/team-tags")).toBe(true);
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
    expect(offlineCapableLabel("/defense-planner")).toBe("Defense planner");
    expect(offlineCapableLabel("/picklist-collab")).toBe("Collaborative pick list");
    expect(offlineCapableLabel("/dossier")).toBe("Dossier");
    expect(offlineCapableLabel("/pit-repair-triage")).toBe("Pit repair triage");
    expect(offlineCapableLabel("/event-day-plan")).toBe("Event-day plan");
    expect(offlineCapableLabel("/field-reset-timer")).toBe("Field reset timer");
    expect(offlineCapableLabel("/drive-team-signals")).toBe("Drive-team signals");
    expect(offlineCapableLabel("/robot-weigh-in")).toBe("Robot weigh-in");
    expect(offlineCapableLabel("/match-delta-watcher")).toBe("Match-delta watcher");
    expect(offlineCapableLabel("/match-video-index")).toBe("Match video index");
    expect(offlineCapableLabel("/strategy/draft")).toBe("Alliance board");
    expect(offlineCapableLabel("/scouting/lineup")).toBe("Lineup & coverage");
    expect(offlineCapableLabel("/match-strategy-cards")).toBe("Match strategy cards");
    expect(offlineCapableLabel("/match-copilot")).toBe("Match Copilot");
    expect(offlineCapableLabel("/event-readiness")).toBe("Event readiness");
    expect(offlineCapableLabel("/video-analysis")).toBe("Video");
    expect(offlineCapableLabel("/video")).toBe("Match video");
    expect(offlineCapableLabel("/inspection-copilot")).toBe("Inspection Copilot");
    expect(offlineCapableLabel("/inspection")).toBe("Inspection");
    expect(offlineCapableLabel("/fmea")).toBe("FMEA");
    expect(offlineCapableLabel("/match-sim")).toBe("Match Simulator");
    expect(offlineCapableLabel("/pit-map-planner")).toBe("Pit Map Planner");
    expect(offlineCapableLabel("/pairwise")).toBe("Pairwise ranking");
    expect(offlineCapableLabel("/team-tags")).toBe("Drive-team tags");
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
    expect(featureCacheKey("defense-planner", "org-1", "2026")).toBe("defense-planner:org-1:2026");
    expect(featureCacheKey("picklist-collab", "org-1", "list-1")).toBe("picklist-collab:org-1:list-1");
    expect(featureCacheKey("dossier", "org-1", "frc254")).toBe("dossier:org-1:frc254");
    expect(featureCacheKey("pit-repair", "org-1", "2026")).toBe("pit-repair:org-1:2026");
    expect(featureCacheKey("event-day-plan", "org-1", "2026onto")).toBe("event-day-plan:org-1:2026onto");
    expect(featureCacheKey("field-reset", "org-1", "2026")).toBe("field-reset:org-1:2026");
    expect(featureCacheKey("drive-signals", "org-1")).toBe("drive-signals:org-1");
    expect(featureCacheKey("weigh-in", "org-1", "2026")).toBe("weigh-in:org-1:2026");
    expect(featureCacheKey("match-delta", "org-1", "2026onto")).toBe("match-delta:org-1:2026onto");
    expect(featureCacheKey("match-video-index", "org-1")).toBe("match-video-index:org-1");
    expect(featureCacheKey("draft", "org-1", "2026onto")).toBe("draft:org-1:2026onto");
    expect(featureCacheKey("lineup", "org-1", "2026onto")).toBe("lineup:org-1:2026onto");
    expect(featureCacheKey("strategy-cards", "org-1")).toBe("strategy-cards:org-1");
    expect(featureCacheKey("match-copilot", "org-1")).toBe("match-copilot:org-1");
    expect(featureCacheKey("event-readiness", "org-1", "2026onto")).toBe("event-readiness:org-1:2026onto");
    expect(featureCacheKey("match-video", "org-1")).toBe("match-video:org-1");
    expect(featureCacheKey("inspection", "org-1")).toBe("inspection:org-1");
    expect(featureCacheKey("inspection-copilot", "org-1", "2026")).toBe("inspection-copilot:org-1:2026");
    expect(featureCacheKey("fmea", "org-1", "2026")).toBe("fmea:org-1:2026");
    expect(featureCacheKey("match-sim", "org-1")).toBe("match-sim:org-1");
    expect(featureCacheKey("pit-map", "org-1", "2026")).toBe("pit-map:org-1:2026");
    expect(featureCacheKey("pairwise", "org-1")).toBe("pairwise:org-1");
    expect(featureCacheKey("team-tags", "org-1")).toBe("team-tags:org-1");
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

