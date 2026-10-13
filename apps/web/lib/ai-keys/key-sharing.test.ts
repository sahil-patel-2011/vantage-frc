import { describe, expect, it } from "vitest";
import { parseKeySharing } from "./key-sharing";

const person = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("personal AI key sharing boundaries", () => {
  it("requires an explicit valid scope", () => {
    for (const value of [undefined, null, "all", true, {}]) expect(() => parseKeySharing(value, [person])).toThrow();
  });
  it("clears obsolete recipients when sharing ends or changes to the whole team", () => {
    expect(parseKeySharing("personal", [person])).toEqual({ shareScope: "personal", shareUserIds: [] });
    expect(parseKeySharing("team", [person])).toEqual({ shareScope: "team", shareUserIds: [] });
  });
  it("refuses empty, malformed and excessive selected recipients", () => {
    for (const value of [null, [], ["all"], [{}], [person, 1], Array(101).fill(person)]) expect(() => parseKeySharing("selected", value)).toThrow();
  });
  it("normalizes and deduplicates identities before membership validation", () => {
    expect(parseKeySharing("selected", [person, person.toUpperCase()])).toEqual({ shareScope: "selected", shareUserIds: [person] });
  });
});
