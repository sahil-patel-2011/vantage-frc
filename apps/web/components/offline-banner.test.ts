import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  A6-21: a loaded Home that lost signal said "This page needs a prior online visit to load from
  cache", the cold-start message, over a page that was on screen; /scout/pit had no offline notice.
*/

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const banner = read("components/offline-banner.tsx");

describe("offline banner", () => {
  it("says what is on screen when the page loaded online and then lost signal", () => {
    expect(banner).toMatch(/if \(online && navigator\.onLine\) setLoadedOnlineAt\(/);
    expect(banner).toMatch(/`Showing what was loaded at \$\{loadedAt\}\. Changes that need the internet wait until you reconnect\.`/);
  });

  it("keeps the cold-start advice for a page this device never saved, in plain words", () => {
    expect(banner).not.toMatch(/prior online visit/);
    expect(banner).toMatch(/hasn't been saved on this device yet\. Open it once while you have signal/);
  });

  it("does not shout the page name in the title", () => {
    expect(banner).toMatch(/title = "You're offline";/);
  });

  it("is on Pit and Match scouting in the Scouting app", () => {
    expect(read("app/scout/pit/page.tsx")).toMatch(/<OfflineBanner feature="Pit scouting"/);
    expect(read("app/scout/match/page.tsx")).toMatch(/<OfflineBanner feature="Match scouting"/);
  });
});
