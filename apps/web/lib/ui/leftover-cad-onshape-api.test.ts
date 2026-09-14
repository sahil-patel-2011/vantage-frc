import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentOnshapeApiSetup } from "../cad/onshape-setup-copy";

const WEB = join(__dirname, "..", "..");

/**
 * Student CAD APIs must not leak operator Setup required / env-var / callback
 * copy. Connectors catalog stays the operator surface.
 */
const FILES = [
  "app/api/cad/route.ts",
  "app/api/cad/onshape/route.ts",
  "app/api/cad/agent/route.ts",
] as const;

describe("leftover student CAD Onshape API chrome", () => {
  it("does not spread operator setup status onto student CAD routes", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/\.\.\.onshapeSetupStatus\(\)/);
      expect(src, rel).not.toMatch(/onshapeSetupStatus\(\)\.message/);
    }
    const onshape = readFileSync(join(WEB, "app/api/cad/onshape/route.ts"), "utf8");
    expect(onshape).toMatch(/studentOnshapeApiSetup/);
  });

  it("student setup payload stays mentor-ask copy", () => {
    const setup = studentOnshapeApiSetup({});
    expect(setup.message).not.toMatch(/Setup required|ONSHAPE_|Vercel/);
    expect(setup).not.toHaveProperty("missingEnv");
    expect(setup).not.toHaveProperty("callbackUrl");
  });
});
