import { describe, expect, it } from "vitest";
import { onshapeDocumentHref, parseOnshapeDocumentList } from "./explore-progress";

describe("parseOnshapeDocumentList", () => {
  it("keeps names and last-edited times from a real Onshape list", () => {
    const documents = parseOnshapeDocumentList({
      items: [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          name: "CAD lessons — Sahil",
          modifiedAt: "2026-09-13T18:00:00.000Z",
        },
        { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "  ", createdAt: "2026-09-01T12:00:00.000Z" },
      ],
    });
    expect(documents).toEqual([
      {
        id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        name: "CAD lessons — Sahil",
        modifiedAt: "2026-09-13T18:00:00.000Z",
        href: onshapeDocumentHref("aaaaaaaaaaaaaaaaaaaaaaaa"),
      },
      {
        id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        name: "Untitled",
        modifiedAt: "2026-09-01T12:00:00.000Z",
        href: onshapeDocumentHref("bbbbbbbbbbbbbbbbbbbbbbbb"),
      },
    ]);
  });

  it("returns nothing for junk so the page cannot invent a document", () => {
    expect(parseOnshapeDocumentList(null)).toEqual([]);
    expect(parseOnshapeDocumentList({ items: [{ name: "no id" }] })).toEqual([]);
  });
});
