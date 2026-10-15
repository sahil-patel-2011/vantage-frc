import { describe, expect, it } from "vitest";
import notes from "../../release-notes.json";
import { currentRelease, pullRequestNumber, releaseTitle, type ReleaseNotesFile } from "./current-release";

const file = notes as ReleaseNotesFile;

describe("current release", () => {
  it("uses the hand-written notes for the merged pull request", () => {
    const release = currentRelease(
      { VERCEL_GIT_COMMIT_SHA: "9ddc396abe15acbdff8c07c06fd37157db68d564", VERCEL_GIT_COMMIT_MESSAGE: "Merge pull request #2389 from org/branch\n\nOne button system" },
      file,
    );
    expect(release.id).toBe("9ddc396abe15");
    expect(release.pr).toBe(2389);
    expect(release.headline).toBe("Clearer buttons, and delete buttons that stay out of the way");
    expect(release.changes.length).toBeGreaterThan(0);
  });

  it("still ships notes without an entry: the pull request's title", () => {
    const release = currentRelease(
      { VERCEL_GIT_COMMIT_SHA: "abc", VERCEL_GIT_COMMIT_MESSAGE: "Merge pull request #9999 from org/x\n\nFaster scouting saves\n\nDetails" },
      file,
    );
    expect(release.headline).toBe("Faster scouting saves");
    expect(release.changes).toEqual([]);
    expect(currentRelease({}, file)).toMatchObject({ id: "local", headline: "Vantage has been updated" });
  });

  it("reads pull request numbers and titles", () => {
    expect(pullRequestNumber("Merge pull request #12 from a/b")).toBe(12);
    expect(pullRequestNumber("Fix a thing")).toBeNull();
    // A squash merge puts the number at the end of the title.
    expect(pullRequestNumber("Clearer buttons (#2389)\n\n* details")).toBe(2389);
    expect(releaseTitle("Clearer buttons (#2389)\n\n* details")).toBe("Clearer buttons");
    expect(releaseTitle("Fix a thing\n\nbody")).toBe("Fix a thing");
    expect(releaseTitle("")).toBeNull();
  });
});

describe("release notes file", () => {
  it("has one well-formed entry per pull request, newest first", () => {
    const prs = file.releases.map((release) => release.pr);
    expect(new Set(prs).size).toBe(prs.length);
    expect([...prs].sort((a, b) => b - a)).toEqual(prs);
    for (const release of file.releases) {
      expect(release.headline.trim().length).toBeGreaterThan(0);
      expect(release.changes.length).toBeGreaterThan(0);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("is written in plain words: no file paths, code names or migration numbers", () => {
    for (const release of file.releases) {
      for (const line of [release.headline, ...release.changes]) {
        expect(line, line).not.toMatch(/\.(tsx?|css|sql|json)\b|\/[a-z-]+\/|`|\bmigration\b|\b0\d{3}\b|[a-z][A-Z][a-z]+[A-Z]/);
      }
    }
  });
});
