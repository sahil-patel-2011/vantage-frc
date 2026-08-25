import { describe, expect, it } from "vitest";
import {
  RELEASE_HIGHLIGHTS_MAX,
  classifyCommitLines,
  composeReleaseNotes,
  lintReleaseNotes,
  releaseNotesToMarkdown,
  stripCommitHash,
  type ReleaseSourceMaterial,
} from "./compose-release-notes";

const material: ReleaseSourceMaterial = {
  version: "1.4.0",
  since: {
    gitLog: [
      "80859a3 Make Team calendar, chat, and playbook usable on first open.",
      "110bca4 Fix scouting form dropping the last match entry",
      "35a5bb5 Add pit-repair triage board",
    ],
    featureSummaries: ["Pit repair triage lets the pit crew rank broken subsystems."],
  },
};

const goodDraft = {
  headline: "Scouting keeps every entry, and the pit gets a triage board",
  highlights: [
    "The pit crew can now rank broken subsystems on one board and clear the queue fastest-first.",
    "Team calendar, chat, and playbook are ready the moment they open — no setup detour.",
  ],
  improvements: ["Team pages open faster on event-day connections."],
  fixes: ["The scouting form no longer drops the final match entry when submitted quickly."],
};

describe("composeReleaseNotes", () => {
  it("composes valid notes and defaults the email subject to the headline", () => {
    const result = composeReleaseNotes(material, goodDraft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.version).toBe("1.4.0");
    expect(result.notes.emailSubject).toBe(goodDraft.headline);
    expect(result.notes.highlights).toHaveLength(2);
    expect(result.notes.fixes).toHaveLength(1);
  });

  it("refuses to compose when there are no real changes", () => {
    const result = composeReleaseNotes(
      { version: "1.4.0", since: { gitLog: [] } },
      goodDraft,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/never be invented/);
  });

  it("caps highlights at five", () => {
    const result = composeReleaseNotes(material, {
      ...goodDraft,
      highlights: Array.from({ length: RELEASE_HIGHLIGHTS_MAX + 1 }, (_, i) => `Benefit number ${i + 1} lands here.`),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/at most 5/);
  });

  it("requires a headline and at least one highlight", () => {
    const result = composeReleaseNotes(material, { headline: "  ", highlights: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/headline: required/);
    expect(result.problems.join("\n")).toMatch(/at least one/);
  });

  it("rejects a multi-line or overlong email subject", () => {
    const result = composeReleaseNotes(material, {
      ...goodDraft,
      emailSubject: "x".repeat(100),
    });
    expect(result.ok).toBe(false);
  });
});

describe("lintReleaseNotes — the quality gate", () => {
  const base = { headline: "A faster event day", highlights: ["Match schedules load in one tap."] };

  it("passes clean, benefit-first prose", () => {
    expect(lintReleaseNotes(base).ok).toBe(true);
  });

  it.each([
    ["fixed bug", { ...base, fixes: ["Fixed a bug in the scouting form."] }],
    ["misc", { ...base, improvements: ["Misc updates across the app."] }],
    ["various", { ...base, improvements: ["Various improvements and polish."] }],
    ["raw file path", { ...base, improvements: ["Rewrote apps/web/app/scouting/page.tsx for speed."] }],
    ["first person (we)", { ...base, highlights: ["We rebuilt the strategy screen."] }],
    ["first person (our)", { ...base, highlights: ["Our new strategy screen is faster."] }],
    ["commit hash", { ...base, fixes: ["Resolved in 80859a3."] }],
  ])("rejects %s", (_label, notes) => {
    const result = lintReleaseNotes(notes);
    expect(result.ok).toBe(false);
  });

  it("does not flag plain numbers or ordinary words as hashes", () => {
    const result = lintReleaseNotes({
      ...base,
      improvements: ["Handles rosters up to 1000000 rows without slowing down."],
    });
    expect(result.ok).toBe(true);
  });

  it("names the offending section so the author knows what to rewrite", () => {
    const result = lintReleaseNotes({ ...base, fixes: ["Fixed a bug."] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]).toMatch(/^fixes\[0\]/);
  });
});

describe("classifyCommitLines", () => {
  it("strips hashes, drops merges, and buckets by kind", () => {
    const buckets = classifyCommitLines([
      "80859a3 Fix scouting form dropping entries",
      "abc1234 Merge branch 'main' into feature",
      "def5678 Add battery log export",
      "1234abc Tighten strategy query performance",
      "1234abc Tighten strategy query performance",
    ]);
    expect(buckets.fixes).toEqual(["Fix scouting form dropping entries"]);
    expect(buckets.features).toEqual(["Add battery log export"]);
    expect(buckets.improvements).toEqual(["Tighten strategy query performance"]);
  });

  it("strips only leading hash-shaped prefixes", () => {
    expect(stripCommitHash("80859a3 Ship it")).toBe("Ship it");
    expect(stripCommitHash("Ship it")).toBe("Ship it");
  });
});

describe("releaseNotesToMarkdown", () => {
  it("renders sections in order and omits empty ones", () => {
    const result = composeReleaseNotes(material, { ...goodDraft, improvements: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const markdown = releaseNotesToMarkdown(result.notes);
    expect(markdown.startsWith(goodDraft.headline)).toBe(true);
    expect(markdown).toContain("Highlights");
    expect(markdown).toContain("Fixes");
    expect(markdown).not.toContain("Improvements");
  });
});
