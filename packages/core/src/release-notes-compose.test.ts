import { describe, expect, it } from "vitest";
import { composeReleaseNotes, releaseSlugForVersion } from "./release-notes-compose";

describe("composeReleaseNotes", () => {
  it("produces the same shape for every release", () => {
    const composed = composeReleaseNotes({
      version: "2026.3",
      headline: "Scouting is faster on the field.",
      added: ["Tap-based match scoring"],
      fixed: ["fix: crash when opening a team profile (a1b2c3d)"],
    });

    expect(composed.title).toBe("Vantage 2026.3");
    expect(composed.slug).toBe("release-2026-3");
    expect(composed.notesMarkdown).toBe(
      [
        "Scouting is faster on the field.",
        "",
        "**New**",
        "- Tap-based match scoring",
        "",
        "**Fixed**",
        "- Crash when opening a team profile",
      ].join("\n"),
    );
  });

  it("strips technical residue and duplicates, and caps bullet length", () => {
    const composed = composeReleaseNotes({
      version: "v1.4.0",
      headline: "chore: polish",
      improved: [
        "`apps/web/app/scouting/page.tsx` cleanup (#412)",
        "Cleanup",
        "cleanup",
        `Improved ${"word ".repeat(40)}`,
      ],
    });

    const items = composed.sections[0]?.items ?? [];
    expect(composed.headline).toBe("Polish");
    expect(items[0]).toBe("Cleanup");
    expect(items).toHaveLength(2);
    expect((items[1] ?? "").length).toBeLessThanOrEqual(110);
  });

  it("rejects empty or unusable input", () => {
    expect(() => composeReleaseNotes({ version: "2026.3", headline: "Nothing" })).toThrow();
    expect(() => composeReleaseNotes({ version: "spring", headline: "x", added: ["y"] })).toThrow();
    expect(releaseSlugForVersion("2026.3.1")).toBe("release-2026-3-1");
  });
});
