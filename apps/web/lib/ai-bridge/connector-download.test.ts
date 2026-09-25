import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// /team/ai-bridge offers public/vantage-ai-bridge.mjs for download. It is a copy of the
// connector's source; a change to one without the other would hand mentors an old bridge.
describe("the downloadable Claude Code connector", () => {
  it("is the same file as packages/ai-bridge/bridge.mjs", () => {
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    const source = readFileSync(join(__dirname, "../../../../packages/ai-bridge/bridge.mjs"), "utf8");
    const served = readFileSync(join(__dirname, "../../public/vantage-ai-bridge.mjs"), "utf8");
    expect(normalize(served)).toBe(normalize(source));
  });
});
