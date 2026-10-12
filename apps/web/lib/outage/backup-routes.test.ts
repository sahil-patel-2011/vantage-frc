import { describe, expect, it } from "vitest";
import { backupModeRoute } from "./backup-routes";

describe("backup mode routes", () => {
  it("keeps the public site, legal pages and the sign-in notice", () => {
    for (const path of ["/", "/features", "/features/cad", "/pricing", "/for-teams", "/desktop", "/privacy", "/terms", "/signin", "/sign-in", "/offline"]) {
      expect(backupModeRoute(path)).toBe("pass");
    }
  });

  it("keeps static files and Next's own assets", () => {
    for (const path of ["/_next/static/chunks/app.js", "/brand/logo.svg", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/sw.js", "/team-setup.ps1", "/vantage-ai-bridge.mjs"]) {
      expect(backupModeRoute(path)).toBe("pass");
    }
  });

  it("keeps only the endpoints that never read the database", () => {
    for (const path of ["/api/health", "/api/status", "/api/status/outage", "/api/status/outage/banner", "/api/waitlist", "/api/desktop/release"]) {
      expect(backupModeRoute(path)).toBe("pass");
    }
    expect(backupModeRoute("/status/outage/open")).toBe("pass");
  });

  it("answers every other API with backup mode, sign-in included", () => {
    for (const path of ["/api", "/api/me", "/api/auth/get-session", "/api/auth/email-otp/send-verification-otp", "/api/scouting/sync", "/api/teams/join", "/api/healthz", "/api/waitlisted"]) {
      expect(backupModeRoute(path)).toBe("api_unavailable");
    }
  });

  it("sends every page that needs data to the notice", () => {
    for (const path of ["/dashboard", "/scout", "/admin", "/onboarding", "/invite", "/join-team", "/parent-view/abcdefghijklmnop", "/f/0123456789abcdef0123456789abcdef", "/features-secret", "/statusx"]) {
      expect(backupModeRoute(path)).toBe("notice");
    }
  });
});
