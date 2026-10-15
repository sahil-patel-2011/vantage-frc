import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("Code review tabs", () => {
  it("opens Repo scan when the hub's AI Bugbot tab (?tab=bugbot) is chosen", () => {
    expect(read("code-client.tsx")).toMatch(/initialTab=\{focusBugbot \? "scan" : "review"\}/);
    const view = read("code-ready-view.tsx");
    expect(view).toMatch(/useState<CodeTab>\(initialTab \?\? "review"\)/);
    expect(view).toMatch(/if \(initialTab\) setTab\(initialTab\)/);
  });
});
