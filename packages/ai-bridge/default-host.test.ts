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
    expect(CANONICAL_BASE_URL).toBe("https://vantage-frc-web.vercel.app");
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

  it("is the origin packages/core trusts", async () => {
    const { CANONICAL_BASE_URL } = await bridgeModule();
    expect(readRepoFile("packages/core/src/access-policy.ts")).toContain(
      `"${CANONICAL_BASE_URL}"`,
    );
  });
});
