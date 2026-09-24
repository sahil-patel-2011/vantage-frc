import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Discord last snapshot stays on the phone", () => {
  it("reads and writes the discord IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "discord-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"discord"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Discord"/);
    expect(src).not.toMatch(/if \(fetchFailed \|\| view == null\)/);
    expect(src).not.toMatch(/DISCORD_BOT_TOKEN/);
    // One path: paste the webhook link, 3 steps, Send test; ids and bot under Advanced.
    expect(src).toMatch(/Copy Webhook URL/);
    expect(src).toMatch(/Send test/);
    expect(src).toMatch(/<summary>Advanced<\/summary>/);
    expect(src).not.toMatch(/Guild \(server\) id/);
  });
});
