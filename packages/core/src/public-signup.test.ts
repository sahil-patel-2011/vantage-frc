import { describe, expect, it } from "vitest";
import { isLocalAcceptanceSignup, isPublicSignupOpen, publicSignupEnvEnabled, publicSignupStatus } from "./public-signup";
describe("production readiness controls public signup", () => {
  const ready = { VANTAGE_PUBLIC_SIGNUP: "open", VANTAGE_PRODUCTION_VERIFIED: "1" };
  it("opens at midnight Eastern on December 1 only after acceptance", () => {
    expect(isPublicSignupOpen(new Date("2026-12-01T04:59:59.999Z"), ready)).toBe(false);
    expect(isPublicSignupOpen(new Date("2026-12-01T05:00:00.000Z"), ready)).toBe(true);
    expect(isPublicSignupOpen(new Date("2026-11-01"), {})).toBe(false);
    expect(isPublicSignupOpen(new Date("2026-12-02"), { VANTAGE_PUBLIC_SIGNUP: "open" })).toBe(false);
    expect(isPublicSignupOpen(new Date("2026-12-02"), { VANTAGE_PRODUCTION_VERIFIED: "1" })).toBe(false);
    expect(isPublicSignupOpen(new Date("invalid"), ready)).toBe(false);
  });
  it("only accepts the intended values and can be closed immediately", () => {
    for (const value of ["true", "1", "yes", "opened", ""]) expect(publicSignupEnvEnabled({ VANTAGE_PUBLIC_SIGNUP: value })).toBe(false);
    expect(publicSignupEnvEnabled({ VANTAGE_PUBLIC_SIGNUP: "OPEN " })).toBe(true);
    expect(isPublicSignupOpen(new Date("2026-12-02"), { ...ready, VANTAGE_PUBLIC_SIGNUP: "closed" })).toBe(false);
    expect(isPublicSignupOpen(new Date("2026-12-02"), { ...ready, VANTAGE_PRODUCTION_VERIFIED: "0" })).toBe(false);
  });
  it("explains the remaining readiness requirement", () => {
    expect(publicSignupStatus(new Date("2026-11-01"), ready)).toMatchObject({ open: false, dateReached: false, earliest: "2026-12-01T05:00:00.000Z" });
    expect(publicSignupStatus(new Date("2026-11-01"), ready).reason).toContain("early access");
    expect(publicSignupStatus(new Date("2026-12-02"), {}).reason).toContain("production verification");
    expect(publicSignupStatus(new Date("2026-12-02"), { VANTAGE_PRODUCTION_VERIFIED: "1" }).reason).toContain("VANTAGE_PUBLIC_SIGNUP=open");
    expect(publicSignupStatus(new Date("2026-12-02"), ready)).toMatchObject({ open: true, readinessVerified: true });
  });
});

describe("isolated local acceptance signup", () => {
  const local: NodeJS.ProcessEnv = {
    NODE_ENV: "development", VERCEL: "0", VANTAGE_LOCAL_ACCEPTANCE_SIGNUP: "1",
    BETTER_AUTH_URL: "http://127.0.0.1:3417", NEXT_PUBLIC_APP_URL: "http://localhost:3417",
    DATABASE_URL: "postgresql://test_admin@127.0.0.1:55439/vantage_release_test?sslmode=disable",
  };
  it("opens real local signup without marking production verified", () => {
    expect(isPublicSignupOpen(new Date("2026-09-27"), local)).toBe(true);
    expect(publicSignupStatus(new Date(), local)).toMatchObject({ open: true, localAcceptance: true, readinessVerified: false });
    expect(isPublicSignupOpen(new Date("invalid"), local)).toBe(false);
  });
  it("requires explicit development mode and never enables a hosted deployment", () => {
    for (const override of [
      { VANTAGE_LOCAL_ACCEPTANCE_SIGNUP: "0" }, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { VERCEL: "1" },
    ]) expect(isLocalAcceptanceSignup({ ...local, ...override })).toBe(false);
  });
  it("rejects remote origins, remote database aliases and ordinary databases", () => {
    for (const override of [
      { BETTER_AUTH_URL: "https://vantagefrc.vercel.app" }, { NEXT_PUBLIC_APP_URL: "https://example.test" },
      { DATABASE_AUTH_URL: "postgres://test_admin@remote.example/vantage_test" },
      { DATABASE_WORKER_URL: "postgres://test_admin@remote.example/vantage_test" },
      { DATABASE_URL: "postgres://test_admin@localhost/vantage" },
      { DATABASE_URL: "postgres://test_admin@localhost/vantage_test?host=remote.example" },
      { DATABASE_URL: "invalid" }, { DATABASE_URL: "" }, { BETTER_AUTH_URL: "", NEXT_PUBLIC_APP_URL: "" },
    ]) expect(isLocalAcceptanceSignup({ ...local, ...override })).toBe(false);
  });
});
