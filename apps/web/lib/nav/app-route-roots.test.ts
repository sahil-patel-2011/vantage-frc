import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTE_ROOTS, isKnownAppPath } from "./app-route-roots";

const APP_DIR = join(__dirname, "..", "..", "app");

describe("app route roots", () => {
  it("lists exactly the folders under app/", () => {
    const folders = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // A new app/<feature> folder must be added to lib/nav/app-route-roots.ts, or signed-out
    // visitors get the 404 page instead of the sign-in page for it.
    expect([...APP_ROUTE_ROOTS].sort()).toEqual(folders);
  });

  it("has no dynamic or grouped top-level folders, which a first-segment check can't see", () => {
    expect([...APP_ROUTE_ROOTS].filter((name) => /^[[(@_]/.test(name))).toEqual([]);
  });

  it("tells real pages from addresses that exist nowhere", () => {
    expect(isKnownAppPath("/")).toBe(true);
    expect(isKnownAppPath("/dashboard")).toBe(true);
    expect(isKnownAppPath("/admin/integrations")).toBe(true);
    expect(isKnownAppPath("/api/admin/sheets-hub")).toBe(true);
    expect(isKnownAppPath("/definitely-not-a-page")).toBe(false);
    expect(isKnownAppPath("/wp-login.php")).toBe(false);
  });
});
