import { describe, expect, it } from "vitest";
import { parseDreamMemories } from "../src/memory-dream";

describe("parseDreamMemories", () => {
  it("parses valid JSON payloads", () => {
    const raw = "Here you go:\n{\"memories\":[\"Fixed CANivore LED after pit check\",\"Scouts ranked 254 defense high\"]}\n";
    expect(parseDreamMemories(raw)).toEqual([
      "Fixed CANivore LED after pit check",
      "Scouts ranked 254 defense high",
    ]);
  });

  it("filters too-short strings", () => {
    expect(parseDreamMemories('{"memories":["hi","Valid memory bullet here"]}')).toEqual([
      "Valid memory bullet here",
    ]);
  });

  it("returns empty on garbage", () => {
    expect(parseDreamMemories("not json")).toEqual([]);
  });
});
