import { describe, expect, it } from "vitest";
import { nameTheJoiner } from "./joiner-names";

describe("nameTheJoiner", () => {
  it("names the person when known and leaves other titles alone", () => {
    expect(nameTheJoiner("Someone you invited joined as Student", "Sam Lee (sam@school.org)")).toBe(
      "Sam Lee (sam@school.org) joined as Student",
    );
    expect(nameTheJoiner("Someone you invited joined as Student", undefined)).toBe("Someone you invited joined as Student");
    expect(nameTheJoiner("Ava Chen joined as Mentor", "x")).toBe("Ava Chen joined as Mentor");
  });
});
