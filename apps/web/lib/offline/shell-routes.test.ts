import { describe, expect, it } from "vitest";
import { featureCacheKey } from "./feature-cache";
import {
  navigationFallbackPath,
  offlineCapableLabel,
  pathnameIsOfflineShell,
  isRscRequest,
} from "./shell-routes";

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
    expect(pathnameIsOfflineShell("/team")).toBe(true);
    expect(pathnameIsOfflineShell("/dashboard")).toBe(false);
    expect(pathnameIsOfflineShell("/api/todos")).toBe(false);
  });

  it("labels offline-capable surfaces for banners", () => {
    expect(offlineCapableLabel("/scouting?orgId=x")).toBe("Scouting");
    expect(offlineCapableLabel("/team/calendar")).toBe("Calendar");
    expect(offlineCapableLabel("/calendar")).toBe("Calendar");
    expect(offlineCapableLabel("/todos")).toBe("Todos");
    expect(offlineCapableLabel("/logistics")).toBe("Logistics");
    expect(offlineCapableLabel("/dashboard")).toBeNull();
  });

  it("builds stable feature cache keys", () => {
    expect(featureCacheKey("todos", " org-1 ")).toBe("todos:org-1");
    expect(featureCacheKey("logistics", "")).toBe("logistics:_");
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

