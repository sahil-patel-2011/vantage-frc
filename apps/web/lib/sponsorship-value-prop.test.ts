import { describe, expect, it } from "vitest";
import {
  buildOnePagerLines,
  defaultTitle,
  evaluateCompleteness,
  hasSponsorshipAsk,
  moneyLabel,
  parseCreateOnePager,
  parseUpdateOnePager,
  type SponsorshipOnePager,
} from "./sponsorship-value-prop";

const base: SponsorshipOnePager = {
  id: "p1",
  title: "Season ask",
  seasonYear: 2026,
  whoWeAre: "We are a high-school FRC team building robots and mentors.",
  whatWeDo: "We design, fabricate, and compete while mentoring younger STEM clubs.",
  askCashUsd: 2500,
  askParts: "Aluminum stock and fasteners",
  askMentorship: "Machining mentors on Tuesday nights",
  sponsorGets: "Logo on robot, pit banner, and a mid-season shop tour for your team.",
  inviteEnabled: true,
  inviteDetails: "Shop open house · Saturdays 10am–1pm · 123 Build St",
  status: "draft",
  createdByName: "Alex",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("hasSponsorshipAsk", () => {
  it("accepts any of cash, parts, or mentorship", () => {
    expect(hasSponsorshipAsk({ askCashUsd: 100, askParts: "", askMentorship: "" })).toBe(true);
    expect(hasSponsorshipAsk({ askCashUsd: null, askParts: "belts", askMentorship: "" })).toBe(true);
    expect(hasSponsorshipAsk({ askCashUsd: null, askParts: "", askMentorship: "CAD help" })).toBe(true);
    expect(hasSponsorshipAsk({ askCashUsd: 0, askParts: "", askMentorship: "" })).toBe(false);
  });
});

describe("evaluateCompleteness", () => {
  it("marks a full one-pager complete", () => {
    const result = evaluateCompleteness(base);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("requires invite details when the come-see-us invite is on", () => {
    const result = evaluateCompleteness({ ...base, inviteDetails: "soon" });
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("Come-see-us invite details");
  });

  it("lists missing core sections", () => {
    const result = evaluateCompleteness({
      whoWeAre: "",
      whatWeDo: "",
      askCashUsd: null,
      askParts: "",
      askMentorship: "",
      sponsorGets: "",
      inviteEnabled: false,
      inviteDetails: "",
    });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["Who we are", "What we do", "What we request", "What the sponsor gets"]);
  });
});

describe("buildOnePagerLines", () => {
  it("emits team-scoped sections without inventing metrics", () => {
    const lines = buildOnePagerLines(base, { orgName: "Vantage Robotics", teamNumber: 254 });
    expect(lines[0]).toBe("FRC Team 254 — Vantage Robotics");
    expect(lines).toContain("WHO WE ARE");
    expect(lines).toContain("WHAT WE REQUEST");
    expect(lines).toContain("Cash support: $2,500");
    expect(lines).toContain("COME SEE US");
    expect(lines.join("\n")).not.toMatch(/Team 1678|another org/i);
  });

  it("omits the invite section when disabled", () => {
    const lines = buildOnePagerLines({ ...base, inviteEnabled: false }, { orgName: "Us", teamNumber: null });
    expect(lines).not.toContain("COME SEE US");
  });
});

describe("parsers", () => {
  it("parses create payloads with season fallback", () => {
    const created = parseCreateOnePager(
      {
        title: "Partner one-pager",
        whoWeAre: "Background",
        askCashUsd: "1500.5",
        inviteEnabled: true,
        inviteDetails: "Friday shop tour",
      },
      2026,
    );
    expect(created.seasonYear).toBe(2026);
    expect(created.askCashUsd).toBe(1500.5);
    expect(created.inviteEnabled).toBe(true);
  });

  it("rejects invalid update status", () => {
    expect(() => parseUpdateOnePager({ id: "x", status: "published" })).toThrow(/Invalid status/);
  });
});

describe("helpers", () => {
  it("formats money and default titles", () => {
    expect(moneyLabel(1000)).toBe("$1,000");
    expect(defaultTitle(118, 2026)).toBe("Team 118 · 2026 sponsorship");
    expect(defaultTitle(null, 2026)).toBe("2026 sponsorship one-pager");
  });
});
