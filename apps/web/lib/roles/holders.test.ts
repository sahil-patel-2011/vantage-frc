import { describe, expect, it } from "vitest";
import { attachRoleHolders, canonicalHolderName, resolveRoleHolder, unlinkedHolders } from "./holders";

const roster = [
  { userId: "u-sam", name: "Sam Rodriguez" },
  { userId: "u-alex", name: "Alex Rodriguez" },
  { userId: "u-jo", name: "Jo Chen" },
];

describe("resolveRoleHolder", () => {
  it("reports an unfilled role rather than pretending someone holds it", () => {
    expect(resolveRoleHolder(null, roster)).toEqual({
      holderName: null,
      holderUserId: null,
      holderLink: "unfilled",
    });
    expect(resolveRoleHolder("   ", roster).holderLink).toBe("unfilled");
  });

  it("links an exact name to the member, in the roster's spelling", () => {
    expect(resolveRoleHolder("  sam   rodriguez ", roster)).toEqual({
      holderName: "Sam Rodriguez",
      holderUserId: "u-sam",
      holderLink: "member",
    });
  });

  it("leaves an initial or nickname unlinked instead of guessing between the Rodriguezes", () => {
    const resolved = resolveRoleHolder("Sam R.", roster);
    expect(resolved.holderUserId).toBeNull();
    expect(resolved.holderLink).toBe("unlinked");
    expect(resolved.holderName).toBe("Sam R.");
  });

  it("marks a name two members share as ambiguous", () => {
    const twins = [
      { userId: "u-one", name: "Jamie Park" },
      { userId: "u-two", name: "Jamie Park" },
    ];
    expect(resolveRoleHolder("Jamie Park", twins)).toMatchObject({
      holderUserId: null,
      holderLink: "ambiguous",
    });
  });

  it("keeps a non-member holder (mentor, parent volunteer) as typed", () => {
    expect(resolveRoleHolder("Coach Whitaker", roster)).toMatchObject({
      holderName: "Coach Whitaker",
      holderUserId: null,
      holderLink: "unlinked",
    });
  });
});

describe("canonicalHolderName", () => {
  it("rewrites a confident match to the roster spelling so the column stops drifting", () => {
    expect(canonicalHolderName("rodriguez, sam", roster)).toBe("Sam Rodriguez");
    expect(canonicalHolderName("SAM RODRIGUEZ", roster)).toBe("Sam Rodriguez");
  });

  it("does not rewrite a name it is not sure about", () => {
    expect(canonicalHolderName("Sam R.", roster)).toBe("Sam R.");
  });

  it("normalizes an empty holder to null, not an empty string", () => {
    expect(canonicalHolderName("  ", roster)).toBeNull();
    expect(canonicalHolderName(undefined, roster)).toBeNull();
  });
});

describe("attachRoleHolders", () => {
  it("resolves a whole season of roles in one pass, preserving the other fields", () => {
    const resolved = attachRoleHolders(
      [
        { id: "r1", title: "Safety Captain", holderName: "Sam Rodriguez" },
        { id: "r2", title: "Scouting Lead", holderName: "Sam R." },
        { id: "r3", title: "Media Lead", holderName: null },
      ],
      roster,
    );
    expect(resolved.map((role) => role.holderUserId)).toEqual(["u-sam", null, null]);
    expect(resolved.map((role) => role.holderLink)).toEqual(["member", "unlinked", "unfilled"]);
    expect(resolved[0]!.title).toBe("Safety Captain");
  });
});

describe("unlinkedHolders", () => {
  it("lists only named-but-unlinked holders as the mentor review queue", () => {
    const resolved = attachRoleHolders(
      [
        { id: "r1", title: "Safety Captain", holderName: "Sam Rodriguez" },
        { id: "r2", title: "Scouting Lead", holderName: "Sam R." },
        { id: "r3", title: "Media Lead", holderName: null },
      ],
      roster,
    );
    expect(unlinkedHolders(resolved)).toEqual([
      { id: "r2", title: "Scouting Lead", holderName: "Sam R.", holderLink: "unlinked" },
    ]);
  });
});
