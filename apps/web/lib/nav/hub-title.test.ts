import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hubDocumentTitle, hubInitialTab } from "./hub-title";

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

describe("browser tab titles for hub tabs (A6-10)", () => {
  it("names the tab and its hub", () => {
    expect(hubDocumentTitle("business", "finance")).toBe("Money · Business");
    expect(hubDocumentTitle("competition", "my-day")).toBe("My Day · Competition");
    expect(hubDocumentTitle("competition", "strategy")).toBe("Match plan · Competition");
    expect(hubDocumentTitle("team", "todos")).toBe("Tasks · Team");
  });

  it("uses the default tab for no tab or an unknown one", () => {
    expect(hubDocumentTitle("team", null)).toBe("Calendar · Team");
    expect(hubDocumentTitle("team", "nope")).toBe("Calendar · Team");
    expect(hubInitialTab("competition", undefined)).toBe("scouting");
  });

  it("tells every Competition tab apart", () => {
    const titles = ["scouting", "strategy", "my-day", "command"].map((tab) => hubDocumentTitle("competition", tab));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("hub pages render the asked-for tab on the server", () => {
  for (const [page, client] of [
    ["app/competition/page.tsx", "app/competition/competition-hub.tsx"],
    ["app/team/page.tsx", "app/team/team-hub.tsx"],
    ["app/build/page.tsx", "app/build/build-hub.tsx"],
    ["app/ai/page.tsx", "app/ai/ai-hub.tsx"],
  ] as const) {
    it(page, () => {
      const source = read(page);
      expect(source).toMatch(/export async function generateMetadata/);
      expect(source).toMatch(/hubDocumentTitle\(/);
      expect(source).toMatch(/initialTab=\{tab \?\? null\}/);
      expect(read(client)).toMatch(/initialTab=\{initialTab\}/);
    });
  }

  it("Business too", () => {
    expect(read("app/business/page.tsx")).toMatch(/hubDocumentTitle\("business", tab\)/);
    const client = read("app/business/business-client.tsx");
    expect(client).toMatch(/useState<Tab>\(\(\) => \(isTab\(initialTab\) \? initialTab : "overview"\)\)/);
    expect(client).toMatch(/useDocumentTitle\(hubDocumentTitle\("business", tab\)\)/);
  });

  it("the hub seeds its tab from the server and keeps the tab title in step", () => {
    const hub = read("components/product-hub.tsx");
    expect(hub).toMatch(/useState\(\(\) => hubInitialTab\(hubId, initialTab\)\)/);
    expect(hub).toMatch(/useDocumentTitle\(hubDocumentTitle\(hubId, tab\)\)/);
  });
});
