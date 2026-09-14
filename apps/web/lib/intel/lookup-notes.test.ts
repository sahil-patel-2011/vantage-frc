import { describe, expect, it } from "vitest";
import {
  LOOKUP_NOTE_MAX_CHARS,
  canEditLookupNotes,
  lookupNoteEmptyCopy,
  lookupNoteIsEmpty,
  lookupNotePreview,
  parseLookupNote,
  sanitizeLookupNote,
} from "./lookup-notes";

describe("lookup notes", () => {
  it("trims and caps a note instead of storing junk whitespace", () => {
    expect(sanitizeLookupNote("  strong defense  ")).toBe("strong defense");
    expect(sanitizeLookupNote("x".repeat(LOOKUP_NOTE_MAX_CHARS + 40))).toHaveLength(LOOKUP_NOTE_MAX_CHARS);
    expect(lookupNoteIsEmpty("   ")).toBe(true);
  });

  it("previews without inventing a quote", () => {
    expect(lookupNotePreview("")).toBe("");
    expect(lookupNotePreview("short")).toBe("short");
    expect(lookupNotePreview("a".repeat(200)).endsWith("…")).toBe(true);
  });

  it("lets leads edit and keeps members read-only", () => {
    expect(canEditLookupNotes("admin")).toBe(true);
    expect(canEditLookupNotes("owner")).toBe(true);
    expect(canEditLookupNotes("scout")).toBe(false);
    expect(lookupNoteEmptyCopy(false).detail).toContain("lead");
    expect(parseLookupNote({ body: "  climb is slow " }, "frc254", true).body).toBe("climb is slow");
  });
});
