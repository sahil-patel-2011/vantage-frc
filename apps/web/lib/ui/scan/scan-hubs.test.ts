import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "../../../app");
const SCAN = join(APP, "vantage-scan");
const SKIP = new Set(["win-kit", "lovat-kit", "agent-kit", "api", "vantage-scan"]);

describe("vantage scan hub overlays", () => {
  const hubs = readdirSync(APP).filter((name) => {
    if (SKIP.has(name)) return false;
    try {
      return statSync(join(APP, name)).isDirectory();
    } catch {
      return false;
    }
  });

  it("covers every product route directory with a scoped overlay", () => {
    const missing = hubs.filter((hub) => !existsSync(join(SCAN, `${hub}.css`)));
    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("does not overlay leftover kits", () => {
    expect(existsSync(join(SCAN, "win-kit.css"))).toBe(false);
    expect(existsSync(join(SCAN, "lovat-kit.css"))).toBe(false);
    expect(existsSync(join(SCAN, "agent-kit.css"))).toBe(false);
  });

  it("scopes hub rules and keeps empty honest", () => {
    const dashboard = readFileSync(join(SCAN, "dashboard.css"), "utf8");
    expect(dashboard).toContain(".scan-hub--dashboard");
    expect(dashboard).toContain("Empty stays empty");
    expect(dashboard).not.toContain("Choose tools");
    const scouting = readFileSync(join(SCAN, "scouting.css"), "utf8");
    expect(scouting).toContain("THIS MATCH");
    expect(scouting).toContain(".product-hub--scouting");
  });

  it("barrels every overlay from hubs.css without leftover kits", () => {
    const barrel = readFileSync(join(SCAN, "hubs.css"), "utf8");
    expect(barrel).toContain('@import "./dashboard.css"');
    expect(barrel).toContain('@import "./scouting.css"');
    expect(barrel).toContain('@import "./cad.css"');
    expect(barrel).toContain('@import "./files.css"');
    expect(barrel).not.toContain("win-kit");
    expect(barrel).not.toContain("lovat-kit");
  });
});
