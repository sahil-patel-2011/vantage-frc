import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `node bridge.mjs --setup` with neither `--url` nor VANTAGE_URL pairs against
 * CANONICAL_BASE_URL. bridge.mjs is deliberately stdlib-only and cannot import the
 * TypeScript sources that hold the same origin, so the origin is duplicated — pin both
 * copies here so a future host change has to update every one of them together.
 */
const bridgeModule = () =>
  import(new URL("./bridge.mjs", import.meta.url).href) as Promise<{
    CANONICAL_BASE_URL: string;
  }>;

const readRepoFile = (relative: string) =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

describe("AI bridge default host", () => {
  it("defaults to the canonical production origin", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    expect(CANONICAL_BASE_URL).toBe("https://vantagefrc.vercel.app");
  });

  it("matches the desktop shell's production origin", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    const allowlist = readRepoFile("apps/desktop/src/allowlist.ts");
    const declared = allowlist.match(
      /DEFAULT_PRODUCTION_ORIGIN\s*=\s*"([^"]+)"/,
    );
    expect(declared?.[1]).toBe(CANONICAL_BASE_URL);
  });

  it("matches the web app's SITE_URL fallback", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    expect(readRepoFile("apps/web/lib/site.ts")).toContain(`"${CANONICAL_BASE_URL}"`);
  });

  /*
    The five copies above all held `vantage-frc-web.vercel.app`, which is
    retired and answers DEPLOYMENT_NOT_FOUND. Pinning them to each other kept
    them consistent and did not notice they were consistently wrong, so this
    names the dead host directly.
  */
  it("is not the retired host", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    const RETIRED = "vantage-frc-web.vercel.app";
    expect(CANONICAL_BASE_URL).not.toContain(RETIRED);

    /*
      The declared constants only — not a scan of the files. `site.ts` names
      the retired host on purpose, in the set it rewrites away from, and a
      whole-file search cannot tell a guard against the dead host from a
      pointer at it.
    */
    const declarations: Array<[string, RegExp]> = [
      ["apps/desktop/src/allowlist.ts", /DEFAULT_PRODUCTION_ORIGIN\s*=\s*"([^"]+)"/],
      ["apps/web/lib/site.ts", /LIVE_SITE_ORIGIN\s*=\s*"([^"]+)"/],
      ["packages/core/src/access-policy.ts", /LIVE_AUTH_ORIGIN\s*=\s*"([^"]+)"/],
    ];
    for (const [file, pattern] of declarations) {
      const declared = readRepoFile(file).match(pattern)?.[1];
      expect(declared, `${file} does not declare a canonical origin`).toBeTruthy();
      expect(declared, `${file} still points at the retired host`).not.toContain(RETIRED);
      expect(declared, `${file} disagrees with the bridge about where the app lives`).toBe(
        CANONICAL_BASE_URL,
      );
    }
  });

  it("is the origin packages/core trusts", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    expect(readRepoFile("packages/core/src/access-policy.ts")).toContain(
      `"${CANONICAL_BASE_URL}"`,
    );
  });
});
