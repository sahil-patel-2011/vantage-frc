/**
 * The connectors section of docs/DEPLOYMENT.md is the only place an operator
 * reads before they have a running deployment to look at. A stale one is worse
 * than none: a callback URL that used to be right sends someone to spend an
 * afternoon on a `redirect_uri_mismatch`.
 *
 * So the doc is pinned against the catalog rather than trusted. Every required
 * variable and every callback path in `catalog.ts` has to appear in the file;
 * adding a connector without documenting it fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTORS } from "./catalog";

const DOC = readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "DEPLOYMENT.md"), "utf8");

describe("docs/DEPLOYMENT.md documents every connector", () => {
  it("has the connectors section at all", () => {
    expect(DOC).toContain("## 4b. Connectors");
    expect(DOC).toContain("/connectors");
  });

  it("names every connector in the catalog", () => {
    for (const def of CONNECTORS) {
      expect(DOC, `${def.id} (${def.label}) is missing from DEPLOYMENT.md`).toContain(def.label);
    }
  });

  it("names every required environment variable", () => {
    for (const def of CONNECTORS) {
      for (const name of def.requiredEnv) {
        expect(DOC, `${name} (${def.id}) is missing from DEPLOYMENT.md`).toContain(name);
      }
    }
  });

  it("gives the exact callback path for every connector that has one", () => {
    for (const def of CONNECTORS) {
      if (!def.callbackPath) continue;
      expect(DOC, `${def.id} callback path ${def.callbackPath} is missing from DEPLOYMENT.md`).toContain(
        def.callbackPath,
      );
    }
  });

  it("says plainly that the key-only connectors need no URL, rather than leaving a blank", () => {
    // TBA, Discord and email have no callback. A reader scanning a table of
    // URLs must not conclude their row is simply undocumented.
    expect(DOC).toContain("**none** — TBA has no OAuth and needs no URL from us");
    const noneCount = DOC.split("## 4b.")[1]!.split("| **none**").length - 1;
    expect(noneCount).toBeGreaterThanOrEqual(3);
  });

  it("names at least one provider permission per connector", () => {
    for (const def of CONNECTORS) {
      const first = def.permissions[0];
      if (!first) continue;
      expect(DOC, `${def.id} permission "${first}" is missing from DEPLOYMENT.md`).toContain(first);
    }
  });

  it("records the two invariants the whole change rests on", () => {
    expect(DOC).toMatch(/computed from `BETTER_AUTH_URL` alone, never from the credentials/);
    expect(DOC).toMatch(/"Connected" always means a real stored row/);
  });
});
