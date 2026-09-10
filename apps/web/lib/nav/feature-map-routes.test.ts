import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeFeatureMapRoute, productRoutesFromFeatureMap } from "./feature-map-routes";

const FEATURE_MAP = readFileSync(join(__dirname, "../../../../docs/FEATURE_MAP.md"), "utf8");

describe("productRoutesFromFeatureMap", () => {
  const routes = productRoutesFromFeatureMap(FEATURE_MAP);

  it("keeps hub roots and drops share tokens, APIs, and files", () => {
    expect(normalizeFeatureMapRoute("/dashboard")).toBe("/dashboard");
    expect(normalizeFeatureMapRoute("/ai?tab=chat")).toBe("/ai?tab=chat");
    expect(normalizeFeatureMapRoute("/team/admin#invite-form")).toBe("/team/admin");
    expect(normalizeFeatureMapRoute("/s/<32-hex token>")).toBeNull();
    expect(normalizeFeatureMapRoute("/api/org/analytics/private-epa")).toBeNull();
    expect(normalizeFeatureMapRoute("components/app-shell.tsx")).toBeNull();
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/scouting");
    expect(routes).toContain("/strategy");
    expect(routes).toContain("/connectors");
    expect(routes).toContain("/video-analysis");
    expect(routes).not.toContain("/api/org/analytics/private-epa");
  });

  it("extracts a catalog large enough to be the FEATURE_MAP walk, not a handful of hubs", () => {
    expect(routes.length).toBeGreaterThanOrEqual(80);
  });
});
