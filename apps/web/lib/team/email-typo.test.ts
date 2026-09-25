import { describe, expect, it } from "vitest";
import { likelyEmailTypo } from "./email-typo";

describe("likelyEmailTypo", () => {
  it("names the usual slips", () => {
    expect(likelyEmailTypo("w12-owner-a@example.tset")).toBe("w12-owner-a@example.test");
    expect(likelyEmailTypo("Coach@Gmial.com")).toBe("coach@gmail.com");
    expect(likelyEmailTypo("kid@school.ogr")).toBe("kid@school.org");
  });

  it("leaves real addresses and school domains alone", () => {
    expect(likelyEmailTypo("coach@gmail.com")).toBeNull();
    expect(likelyEmailTypo("student@westlake.k12.ga.us")).toBeNull();
    expect(likelyEmailTypo("not-an-email")).toBeNull();
  });
});
