import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_BUTTON_HIDDEN_ROUTES,
  feedbackButtonAllowedOn,
  feedbackButtonHiddenBy,
} from "./feedback-routes";

describe("where the corner feedback button stays away", () => {
  it("is not on the Quick scout, pit scouting or match entry screens", () => {
    for (const path of ["/scout", "/scout/match", "/scout/pit", "/scout/entry", "/scout/teams"]) {
      expect(feedbackButtonAllowedOn(path), path).toBe(false);
    }
  });

  it("is not on the hours kiosk, but is on the hours page people use at their desk", () => {
    expect(feedbackButtonAllowedOn("/hours/kiosk")).toBe(false);
    expect(feedbackButtonAllowedOn("/hours/kiosk/")).toBe(false);
    expect(feedbackButtonAllowedOn("/hours")).toBe(true);
    expect(feedbackButtonAllowedOn("/hours-self-view")).toBe(true);
  });

  it("is not on the TV boards, onboarding, sign-in, invites or other guided flows", () => {
    for (const path of [
      "/display/pit",
      "/display/stage",
      "/display/kiosk",
      "/onboarding",
      "/signin",
      "/sign-in",
      "/invite",
      "/join-team",
      "/claim",
      "/access-unavailable",
      "/desktop-link",
      "/showcase/present",
    ]) {
      expect(feedbackButtonAllowedOn(path), path).toBe(false);
    }
  });

  it("is not on public pages", () => {
    for (const path of ["/", "/pricing", "/privacy", "/terms", "/features", "/for-teams", "/f/0123456789abcdef0123456789abcdef"]) {
      expect(feedbackButtonAllowedOn(path), path).toBe(false);
    }
  });

  it("is on the working pages inside the app", () => {
    for (const path of ["/dashboard", "/competition", "/team", "/build", "/help", "/account", "/tasks", "/calendar", "/ai"]) {
      expect(feedbackButtonAllowedOn(path), path).toBe(true);
    }
  });

  it("matches whole path segments, so /scouting (the hub) is not swallowed by /scout", () => {
    expect(feedbackButtonAllowedOn("/scouting")).toBe(true);
    expect(feedbackButtonAllowedOn("/scouting/forms")).toBe(true);
    expect(feedbackButtonAllowedOn("/scout-coverage-live")).toBe(true);
    expect(feedbackButtonAllowedOn("/displays")).toBe(true);
  });

  it("says why a page is hidden, for the list in one place", () => {
    expect(feedbackButtonHiddenBy("/scout/match")).toBe("/scout");
    expect(feedbackButtonHiddenBy("/signin")).toBe("sign-in and entry screens");
    expect(feedbackButtonHiddenBy("/pricing")).toBe("outside the app frame");
    expect(feedbackButtonHiddenBy("/dashboard")).toBeNull();
    expect(feedbackButtonHiddenBy(null)).toBe("outside the app frame");
  });

  it("only lists routes that exist, so the list cannot quietly rot", () => {
    const app = join(__dirname, "..", "..", "app");
    for (const { prefix, why } of FEEDBACK_BUTTON_HIDDEN_ROUTES) {
      expect(existsSync(join(app, prefix)), prefix).toBe(true);
      expect(why.length, prefix).toBeGreaterThan(10);
    }
  });
});
