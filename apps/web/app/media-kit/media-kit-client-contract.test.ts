import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "media-kit-client.tsx"), "utf8");

describe("Media Kit asset honesty", () => {
  it("picks real Media library items instead of inventing DEMO logos", () => {
    expect(source).toContain("/api/media-library");
    expect(source).toContain("Pick from Media library");
    expect(source).toContain("withOrgHref(\"/media-library\"");
    expect(source).toContain("item.src");
    expect(source).toContain("Video from Media library");
    expect(source).toContain('kind: item.kind === "video" ? "other" : "photo"');
    expect(source).not.toMatch(/https:\/\/demo\./i);
    expect(source).not.toMatch(/never (a )?DEMO|never invents?/i);
  });
});
