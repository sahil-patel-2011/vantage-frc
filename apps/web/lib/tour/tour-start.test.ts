import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TOUR_REPLAY_PARAM,
  firstTourEligible,
  resolveTourStart,
  tourReplayHref,
  tourReplayRequested,
  tourStartMode,
  withoutReplayParam,
  type TourAccount,
} from "./tour-start";

const NOW = Date.UTC(2026, 9, 5, 12);
const NEW_ACCOUNT: TourAccount = {
  userId: "user-a",
  memberSince: "2026-10-04 08:00:00+00",
  appTourSeen: false,
  onboardingComplete: true,
};

describe("asking for the tour again", () => {
  it("is ?tour=replay, with or without the leading question mark", () => {
    expect(tourReplayRequested("?tour=replay")).toBe(true);
    expect(tourReplayRequested("?orgId=abc&tour=replay")).toBe(true);
    expect(tourReplayRequested("tour=replay")).toBe(true);
  });

  it("is nothing else", () => {
    for (const search of ["", "?", "?tour=", "?tour=1", "?tour=Replay", "?tours=replay", "?orgId=abc"]) {
      expect(tourReplayRequested(search), search).toBe(false);
    }
  });

  it("goes to Home and keeps the team", () => {
    expect(tourReplayHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/dashboard?tour=replay&orgId=11111111-1111-4111-8111-111111111111",
    );
    expect(tourReplayHref(null)).toBe("/dashboard?tour=replay");
    expect(tourReplayHref(undefined)).toBe("/dashboard?tour=replay");
    expect(tourReplayHref("a b&c")).toBe("/dashboard?tour=replay&orgId=a+b%26c");
    expect(tourReplayRequested(new URL(tourReplayHref("x"), "https://v.test").search)).toBe(true);
  });

  it("is removed from the address once started, and nothing else is", () => {
    expect(withoutReplayParam("/dashboard?tour=replay&orgId=abc#top")).toBe("/dashboard?orgId=abc#top");
    expect(withoutReplayParam("/dashboard?tour=replay")).toBe("/dashboard");
    expect(withoutReplayParam("https://vantage.test/dashboard?orgId=abc&tour=replay")).toBe("/dashboard?orgId=abc");
    // Other uses of the word are left alone.
    expect(withoutReplayParam("/dashboard?tour=other")).toBe("/dashboard?tour=other");
    expect(withoutReplayParam("/dashboard?orgId=abc")).toBe("/dashboard?orgId=abc");
    expect(TOUR_REPLAY_PARAM).toBe("tour");
  });
});

describe("the first-run tour is once, on the server's word", () => {
  it("is offered to a newly onboarded account that has not seen it", () => {
    expect(firstTourEligible(NEW_ACCOUNT, NOW)).toBe(true);
    expect(tourStartMode({ search: "", doneInBrowser: false, account: NEW_ACCOUNT, now: NOW })).toBe("first-run");
  });

  it("never again once the server has recorded it, on any device", () => {
    // A different browser has an empty localStorage; the desktop app is the same hosted page.
    // Both ask the server, and the server says it was shown.
    const seen = { ...NEW_ACCOUNT, appTourSeen: true };
    expect(tourStartMode({ search: "", doneInBrowser: false, account: seen, now: NOW })).toBe("none");
  });

  it("never for an account older than two weeks, whatever the browser remembers", () => {
    const old = { ...NEW_ACCOUNT, memberSince: "2026-08-01 00:00:00+00" };
    expect(tourStartMode({ search: "", doneInBrowser: false, account: old, now: NOW })).toBe("none");
  });

  it("never before the profile is finished", () => {
    const early = { ...NEW_ACCOUNT, onboardingComplete: false };
    expect(tourStartMode({ search: "", doneInBrowser: false, account: early, now: NOW })).toBe("none");
  });

  it("never when this browser already showed it", () => {
    expect(tourStartMode({ search: "", doneInBrowser: true, account: NEW_ACCOUNT, now: NOW })).toBe("none");
  });

  it("waits when it cannot tell: no account, no flag, no date", () => {
    expect(tourStartMode({ search: "", doneInBrowser: false, account: null, now: NOW })).toBe("none");
    expect(tourStartMode({ search: "", doneInBrowser: false, account: undefined, now: NOW })).toBe("none");
    expect(firstTourEligible({ ...NEW_ACCOUNT, userId: undefined }, NOW)).toBe(false);
    expect(firstTourEligible({ ...NEW_ACCOUNT, appTourSeen: undefined }, NOW)).toBe(false);
    expect(firstTourEligible({ ...NEW_ACCOUNT, memberSince: null }, NOW)).toBe(false);
  });
});

describe("replay starts the tour whatever it remembers", () => {
  const replay = "?tour=replay&orgId=abc";

  it("beats the browser's marker, an account that has seen it, and an old account", () => {
    expect(tourStartMode({ search: replay, doneInBrowser: true, account: { ...NEW_ACCOUNT, appTourSeen: true }, now: NOW })).toBe("replay");
    expect(tourStartMode({ search: replay, doneInBrowser: false, account: { ...NEW_ACCOUNT, memberSince: "2024-01-01" }, now: NOW })).toBe("replay");
  });

  it("needs no account at all, so no /api/me round trip is waited for", () => {
    expect(tourStartMode({ search: replay, doneInBrowser: false, account: null })).toBe("replay");
  });
});

describe("resolveTourStart: the claim is the only way a first run starts", () => {
  it("never calls the claim for a replay", async () => {
    const claim = vi.fn(async () => true);
    expect(await resolveTourStart("replay", claim)).toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it("starts a first run only when the claim is won, and asks exactly once", async () => {
    const won = vi.fn(async () => true);
    expect(await resolveTourStart("first-run", won)).toBe(true);
    expect(won).toHaveBeenCalledTimes(1);

    const lost = vi.fn(async () => false);
    expect(await resolveTourStart("first-run", lost)).toBe(false);
  });

  it("does not start when the claim cannot be asked: no browser-only fallback", async () => {
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await resolveTourStart("first-run", down)).toBe(false);
  });

  it("does not start, or ask, when nothing asked for the tour", async () => {
    const claim = vi.fn(async () => true);
    expect(await resolveTourStart("none", claim)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("AppTour follows these rules", () => {
  const source = readFileSync(join(__dirname, "..", "..", "components", "app-tour.tsx"), "utf8");

  it("decides the start with tourStartMode and the claim with resolveTourStart", () => {
    expect(source).toContain("tourStartMode(");
    expect(source).toContain("resolveTourStart(mode, claimFirstTour)");
  });

  it("asks the server only from claimFirstTour, which only the first-run path hands over", () => {
    expect(source.match(/fetch\("\/api\/account\/tour"/g)).toHaveLength(1);
    expect(source).toContain("async function claimFirstTour");
  });

  it("removes the replay parameter with history.replaceState once the tour has started", () => {
    expect(source).toContain("window.history.replaceState(");
    expect(source).toMatch(/if \(mode === "replay"\) stripReplayParam\(\);\s*setIndex\(0\)/);
  });

  it("looks again when the address changes without the page changing", () => {
    expect(source).toContain("URL_CHANGE_EVENT");
    expect(source).toContain("[pathname, addressTick]");
  });
});
