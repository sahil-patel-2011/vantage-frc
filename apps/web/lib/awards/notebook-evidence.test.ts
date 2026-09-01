import { describe, expect, it } from "vitest";
import {
  AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL,
  citeAwardNotebookPhotoEvidence,
  isAwardNotebookPhotoEvidence,
  selectAwardNotebookPhotoEvidence,
  type AwardNotebookEntryInput,
} from "./notebook-evidence";

const PHOTO_URL = "https://cdn.example.test/intake.png";

function entry(overrides: Partial<AwardNotebookEntryInput> = {}): AwardNotebookEntryInput {
  return {
    id: "nb-1",
    title: "Switched the intake to compliant wheels",
    body: "CAD screenshot attached after the shop night.",
    hasImageEvidence: true,
    attachments: [{ title: "Intake CAD", kind: "photo", url: PHOTO_URL }],
    ...overrides,
  };
}

describe("isAwardNotebookPhotoEvidence", () => {
  it("accepts only the notebook API flag — not a write-up", () => {
    expect(isAwardNotebookPhotoEvidence(entry())).toBe(true);
    expect(isAwardNotebookPhotoEvidence(entry({ hasImageEvidence: false }))).toBe(false);
    expect(isAwardNotebookPhotoEvidence(entry({ hasImageEvidence: null }))).toBe(false);
    expect(isAwardNotebookPhotoEvidence(entry({ hasImageEvidence: undefined }))).toBe(false);
  });

  it("refuses text-only bodies, including markdown image syntax", () => {
    const textOnly = entry({
      hasImageEvidence: false,
      attachments: [],
      body: "See ![shop photo](https://cdn.example.test/fake.png) from Saturday.",
    });
    expect(isAwardNotebookPhotoEvidence(textOnly)).toBe(false);
    expect(citeAwardNotebookPhotoEvidence(textOnly)).toBeNull();
  });

  it("refuses attachments when the flag is missing or false — fail closed", () => {
    expect(
      isAwardNotebookPhotoEvidence(
        entry({
          hasImageEvidence: false,
          attachments: [{ title: "Stale", kind: "photo", url: PHOTO_URL }],
        }),
      ),
    ).toBe(false);
    expect(
      isAwardNotebookPhotoEvidence({
        id: "nb-bare",
        title: "Notes",
        body: "Long write-up",
        attachments: [{ kind: "photo", url: PHOTO_URL }],
      }),
    ).toBe(false);
  });
});

describe("citeAwardNotebookPhotoEvidence", () => {
  it("lists only resolved image URLs — never invents a photo from the body", () => {
    const cite = citeAwardNotebookPhotoEvidence(
      entry({
        body: "![invented](https://cdn.example.test/from-markdown.png)",
        attachments: [
          { title: "Intake CAD", kind: "photo", url: PHOTO_URL },
          { title: "Notes PDF", kind: "other", url: "https://cdn.example.test/notes.pdf" },
          { title: "Empty", kind: "photo", url: "   " },
        ],
      }),
    );
    expect(cite?.photos).toEqual([{ title: "Intake CAD", url: PHOTO_URL, kind: "photo" }]);
    expect(JSON.stringify(cite)).not.toContain("from-markdown.png");
  });

  it("cites a flagged entry without inventing a URL when attachments were not passed", () => {
    const cite = citeAwardNotebookPhotoEvidence(
      entry({ attachments: undefined, hasImageEvidence: true }),
    );
    expect(cite).toEqual({
      id: "nb-1",
      title: "Switched the intake to compliant wheels",
      photos: [],
    });
  });
});

describe("selectAwardNotebookPhotoEvidence", () => {
  it("keeps photo-backed entries and reports how many text-only write-ups were refused", () => {
    const selected = selectAwardNotebookPhotoEvidence([
      entry({ id: "photo-1" }),
      entry({
        id: "text-1",
        title: "Journal only",
        hasImageEvidence: false,
        attachments: [],
        body: "![not a photo](https://cdn.example.test/nope.png)",
      }),
      entry({ id: "photo-2", title: "Whiteboard", attachments: [{ kind: "graphic", url: PHOTO_URL }] }),
      { id: "text-2", title: "Empty flag", body: "We built an intake." },
    ]);

    expect(selected.photos.map((row) => row.id)).toEqual(["photo-1", "photo-2"]);
    expect(selected.omittedTextOnlyCount).toBe(2);
    expect(selected.photos[1]?.title).toBe("Whiteboard");
  });

  it("treats a missing list as no evidence — never seeds a demo photo", () => {
    expect(selectAwardNotebookPhotoEvidence(undefined)).toEqual({ photos: [], omittedTextOnlyCount: 0 });
    expect(selectAwardNotebookPhotoEvidence([])).toEqual({ photos: [], omittedTextOnlyCount: 0 });
    expect(AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL).toContain("not photo evidence");
  });

  it("never attaches invented impact hours", () => {
    const selected = selectAwardNotebookPhotoEvidence([entry()]);
    expect(selected).not.toHaveProperty("impactHours");
    expect(selected).not.toHaveProperty("hours");
    expect(JSON.stringify(selected)).not.toMatch(/impactHours/i);
    expect(JSON.stringify(selected)).not.toMatch(/\b120 hours\b/i);
  });
});
