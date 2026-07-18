import { describe, expect, it } from "vitest";
import { parseRecognitionAction, tallyAward, validateAward } from "./recognition";

describe("validateAward", () => {
  it("requires a name", () => {
    expect(validateAward({}).ok).toBe(false);
  });
  it("rejects an over-long name", () => {
    expect(validateAward({ name: "x".repeat(200) }).ok).toBe(false);
  });
  it("accepts a valid award", () => {
    expect(validateAward({ name: "MVP", description: "Most valuable" }).ok).toBe(true);
  });
});

describe("tallyAward", () => {
  const noms = [
    { id: "n1", nomineeName: "Sam", reason: "" },
    { id: "n2", nomineeName: "Alex", reason: "" },
  ];
  it("ranks nominations by vote count", () => {
    const result = tallyAward(noms, [{ nominationId: "n2" }, { nominationId: "n2" }, { nominationId: "n1" }], "voting");
    expect(result.ranked[0]?.id).toBe("n2");
    expect(result.ranked[0]?.voteCount).toBe(2);
    expect(result.totalVotes).toBe(3);
  });
  it("does not name a winner until closed", () => {
    expect(tallyAward(noms, [{ nominationId: "n1" }], "voting").winnerId).toBeNull();
    expect(tallyAward(noms, [{ nominationId: "n1" }], "closed").winnerId).toBe("n1");
  });
  it("names no winner when closed with zero votes", () => {
    expect(tallyAward(noms, [], "closed").winnerId).toBeNull();
  });
});

describe("parseRecognitionAction", () => {
  it("parses create_award with season year", () => {
    const action = parseRecognitionAction({ action: "create_award", orgId: "o1", seasonYear: 2026, name: "MVP" });
    expect(action).toMatchObject({ action: "create_award", name: "MVP" });
  });
  it("rejects create_award without season year", () => {
    expect(() => parseRecognitionAction({ action: "create_award", orgId: "o1", name: "MVP" })).toThrow(/seasonYear/);
  });
  it("rejects an invalid stage", () => {
    expect(() => parseRecognitionAction({ action: "set_stage", orgId: "o1", id: "a1", stage: "party" })).toThrow(/stage/);
  });
  it("requires a nominee for add_nomination", () => {
    expect(() => parseRecognitionAction({ action: "add_nomination", orgId: "o1", awardId: "a1" })).toThrow(/nomineeName/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseRecognitionAction({ action: "bribe", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
