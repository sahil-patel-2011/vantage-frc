import { describe, expect, it } from "vitest";
import {
  AWARD_EXPORT_DISCLAIMER,
  AWARD_EXPORT_PAYLOAD_KEYS,
  AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL,
  awardExportFileStem,
  awardExportName,
  awardExportStatusLabel,
  buildAwardExportPayload,
  isRealAwardItem,
  type AwardExportItemInput,
  type AwardExportSubmissionInput,
  type AwardNotebookEntryInput,
} from "./export";

const SUBMISSION: AwardExportSubmissionInput = {
  id: "sub-chair-1",
  seasonYear: 2026,
  awardType: "chairmans",
  title: "Chairman's Award",
  status: "drafting",
  eventKey: "2026mnmi",
  deadline: "2026-01-15",
};

function item(overrides: Partial<AwardExportItemInput> = {}): AwardExportItemInput {
  return {
    id: "item-1",
    kind: "essay",
    prompt: "What is your team's mission and how do you live it out?",
    content: "We mentor four rookie teams and run a Saturday shop open to the district.",
    charLimit: 5000,
    done: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe("isRealAwardItem", () => {
  it("accepts trimmed authored content", () => {
    expect(isRealAwardItem(item())).toBe(true);
    expect(isRealAwardItem(item({ content: "  yes  " }))).toBe(true);
  });

  it("rejects empty, whitespace, and missing content — even if marked done", () => {
    expect(isRealAwardItem(item({ content: null }))).toBe(false);
    expect(isRealAwardItem(item({ content: "" }))).toBe(false);
    expect(isRealAwardItem(item({ content: "   \n\t  " }))).toBe(false);
    expect(isRealAwardItem(item({ content: undefined, done: true }))).toBe(false);
  });
});

describe("awardExportName / status / file stem", () => {
  it("prefers the submission title, then the catalog name", () => {
    expect(awardExportName(SUBMISSION)).toBe("Chairman's Award");
    expect(awardExportName({ ...SUBMISSION, title: "  " })).toBe("Chairman's Award");
    expect(awardExportName({ ...SUBMISSION, title: null, awardType: "safety" })).toBe("Safety Award");
    expect(awardExportName({ ...SUBMISSION, title: null, awardType: "not-a-real-award" })).toBe(
      "not-a-real-award",
    );
  });

  it("labels known workbench statuses and passes through unknowns", () => {
    expect(awardExportStatusLabel("drafting")).toBe("Drafting");
    expect(awardExportStatusLabel("won")).toBe("Won");
    expect(awardExportStatusLabel("custom-status")).toBe("custom-status");
  });

  it("builds a filesystem-safe stem from the award and season", () => {
    expect(awardExportFileStem({ awardName: "Chairman's Award", seasonYear: 2026, submissionId: "abc-123" })).toBe(
      "chairman-s-award-2026-abc-123",
    );
  });
});

describe("buildAwardExportPayload", () => {
  it("includes only real items and reports how many empty rows were omitted", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [
        item({ id: "empty-1", content: "" }),
        item({ id: "real-1", content: "First written answer." }),
        item({ id: "empty-2", prompt: "Unused catalog prompt", content: "   " }),
        item({ id: "real-2", prompt: "How has your team grown FIRST?", content: "We hosted a kickoff." }),
      ],
    });

    expect(payload.items.map((row) => row.id)).toEqual(["real-1", "real-2"]);
    expect(payload.omittedEmptyCount).toBe(2);
    expect(payload.items[0]?.content).toBe("First written answer.");
    expect(payload.items[1]?.prompt).toBe("How has your team grown FIRST?");
  });

  it("does not invent catalog answers when every item is an empty seed", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [
        item({ id: "seed-1", prompt: "What is your team's mission?", content: null }),
        item({ id: "seed-2", prompt: "How has your team grown FIRST?", content: "" }),
      ],
    });

    expect(payload.items).toEqual([]);
    expect(payload.omittedEmptyCount).toBe(2);
    expect(payload.copyText).toContain(AWARD_EXPORT_DISCLAIMER);
    expect(payload.copyText).not.toContain("What is your team's mission?");
    expect(payload.printableHtml).toContain(AWARD_EXPORT_DISCLAIMER);
  });

  it("writes copy-all text as numbered prompt + authored answer for portal paste", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [item({ content: "We run a district STEM night." })],
    });

    expect(payload.copyText).toContain("Chairman's Award");
    expect(payload.copyText).toContain("Season 2026 · 2026mnmi · due 2026-01-15");
    expect(payload.copyText).toContain("Status: Drafting");
    expect(payload.copyText).toContain("1. What is your team's mission and how do you live it out?");
    expect(payload.copyText).toContain("We run a district STEM night.");
    expect(payload.copyText).toContain(AWARD_EXPORT_DISCLAIMER);
  });

  it("builds printable HTML that is PDF-ready and escapes authored HTML", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [
        item({
          prompt: "Mission <script>",
          content: `Line one\n<img src=x onerror="alert(1)">`,
        }),
      ],
    });

    expect(payload.printableHtml.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(payload.printableHtml).toContain("@page");
    expect(payload.printableHtml).toContain("@media print");
    expect(payload.printableHtml).toContain("Chairman&#39;s Award — 2026");
    expect(payload.printableHtml).toContain("white-space: pre-wrap");
    expect(payload.printableHtml).toContain("Mission &lt;script&gt;");
    expect(payload.printableHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(payload.printableHtml).not.toContain("<script>");
    expect(payload.printableHtml).not.toContain("<img src=x");
  });

  it("never attaches invented impact hours or other metric fields", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [item()],
    });

    expect(Object.keys(payload).sort()).toEqual([...AWARD_EXPORT_PAYLOAD_KEYS].sort());
    expect(payload).not.toHaveProperty("impactHours");
    expect(payload).not.toHaveProperty("hours");
    expect(payload).not.toHaveProperty("volunteerHours");
    expect(payload).not.toHaveProperty("communityHours");
    expect(payload.items[0]).not.toHaveProperty("impactHours");
    expect(payload.items[0]).not.toHaveProperty("hours");

    const blob = JSON.stringify(payload);
    expect(blob).not.toMatch(/impactHours/i);
    expect(blob).not.toMatch(/volunteerHours/i);
    expect(blob).not.toMatch(/communityHours/i);
    expect(blob).not.toMatch(/\b120 hours\b/i);
    expect(payload.copyText).toContain("Impact hours are never invented");
  });

  it("records character counts from authored text only — not a fabricated hour total", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [item({ content: "abcd", charLimit: 10 })],
    });
    expect(payload.items[0]?.charCount).toBe(4);
    expect(payload.printableHtml).toContain("4/10 characters");
    expect(payload.printableHtml).not.toMatch(/\b\d+\s+impact hours\b/i);
  });

  it("uses the catalog name and keeps a safe file stem when title is missing", () => {
    const payload = buildAwardExportPayload({
      submission: { ...SUBMISSION, title: null, awardType: "impact" },
      items: [item({ content: "Outreach we actually ran." })],
    });
    expect(payload.awardName).toBe("Impact Award");
    expect(payload.fileStem).toMatch(/^impact-award-2026/);
  });

  it("refuses text-only notebook entries as photo evidence", () => {
    const textOnly: AwardNotebookEntryInput = {
      id: "nb-text",
      title: "Shop night notes",
      body: "We built the intake. See ![photo](https://cdn.example.test/invented.png).",
      hasImageEvidence: false,
      attachments: [],
    };
    const withPhoto: AwardNotebookEntryInput = {
      id: "nb-photo",
      title: "Intake CAD",
      body: "Screenshot after the redesign.",
      hasImageEvidence: true,
      attachments: [
        { title: "Intake CAD", kind: "photo", url: "https://cdn.example.test/intake.png" },
      ],
    };

    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [item({ content: "We mentor four rookie teams." })],
      notebookEntries: [textOnly, withPhoto],
    });

    expect(payload.notebookPhotoEvidence.map((row) => row.id)).toEqual(["nb-photo"]);
    expect(payload.omittedTextOnlyNotebookCount).toBe(1);
    expect(payload.copyText).toContain("Intake CAD");
    expect(payload.copyText).toContain("https://cdn.example.test/intake.png");
    expect(payload.copyText).toContain(AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL);
    expect(payload.copyText).toContain("1 write-up omitted");
    expect(payload.copyText).not.toContain("invented.png");
    expect(payload.printableHtml).toContain("Notebook photo evidence");
    expect(payload.printableHtml).toContain("https://cdn.example.test/intake.png");
    expect(payload.printableHtml).not.toContain("invented.png");
    expect(payload.printableHtml).toContain(AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL);
  });

  it("does not invent notebook photos when no entries are passed", () => {
    const payload = buildAwardExportPayload({
      submission: SUBMISSION,
      items: [item()],
    });
    expect(payload.notebookPhotoEvidence).toEqual([]);
    expect(payload.omittedTextOnlyNotebookCount).toBe(0);
    expect(payload.copyText).not.toContain("Notebook photo evidence");
    expect(JSON.stringify(payload.notebookPhotoEvidence)).toBe("[]");
  });
});
