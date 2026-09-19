import { describe, expect, it } from "vitest";
import {
  PUBLIC_SIGNUP_EARLIEST,
  isPublicSignupOpen,
  publicSignupDateReached,
  publicSignupEnvEnabled,
  publicSignupStatus,
} from "./public-signup";

const BEFORE = new Date("2026-10-01T00:00:00Z");
const AFTER = new Date("2026-11-01T00:00:00Z");
const OPEN = { VANTAGE_PUBLIC_SIGNUP: "open" } as NodeJS.ProcessEnv;
const UNSET = {} as NodeJS.ProcessEnv;

describe("public sign-up stays closed until two separate things are true", () => {
  it("is closed today, with nothing set", () => {
    expect(isPublicSignupOpen(BEFORE, UNSET)).toBe(false);
  });

  it("is closed when the switch is set but the date has not arrived", () => {
    // A stray environment variable must not open the doors early.
    expect(isPublicSignupOpen(BEFORE, OPEN)).toBe(false);
  });

  it("is closed when the date has arrived but nobody set the switch", () => {
    // A date passing is not a decision.
    expect(isPublicSignupOpen(AFTER, UNSET)).toBe(false);
  });

  it("opens only when both hold", () => {
    expect(isPublicSignupOpen(AFTER, OPEN)).toBe(true);
  });

  it("takes only the exact value, so a truthy-looking string does not count", () => {
    for (const value of ["true", "1", "yes", "OPEN ", "opened", ""]) {
      expect(publicSignupEnvEnabled({ VANTAGE_PUBLIC_SIGNUP: value })).toBe(value === "OPEN ");
    }
  });

  it("closes again the moment the switch is removed", () => {
    expect(isPublicSignupOpen(AFTER, OPEN)).toBe(true);
    expect(isPublicSignupOpen(AFTER, UNSET)).toBe(false);
  });
});

describe("publicSignupStatus", () => {
  it("names what is still holding it closed", () => {
    expect(publicSignupStatus(BEFORE, UNSET).reason).toContain(PUBLIC_SIGNUP_EARLIEST);
    expect(publicSignupStatus(BEFORE, UNSET).reason).toContain("VANTAGE_PUBLIC_SIGNUP");

    const waitingOnDate = publicSignupStatus(BEFORE, OPEN);
    expect(waitingOnDate.envEnabled).toBe(true);
    expect(waitingOnDate.dateReached).toBe(false);
    expect(waitingOnDate.reason).toContain("the date has not arrived");

    const waitingOnOperator = publicSignupStatus(AFTER, UNSET);
    expect(waitingOnOperator.dateReached).toBe(true);
    expect(waitingOnOperator.reason).toContain("set VANTAGE_PUBLIC_SIGNUP=open");
  });

  it("says so plainly once it is open", () => {
    expect(publicSignupStatus(AFTER, OPEN)).toMatchObject({ open: true });
    expect(publicSignupStatus(AFTER, OPEN).reason).toBe("Public sign-up is open.");
  });

  it("survives an unparseable clock without opening", () => {
    expect(publicSignupDateReached(new Date("nonsense"))).toBe(false);
    expect(isPublicSignupOpen(new Date("nonsense"), OPEN)).toBe(false);
  });
});
