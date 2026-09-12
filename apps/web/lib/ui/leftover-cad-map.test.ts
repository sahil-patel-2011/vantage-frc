import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student CAD review queue / Control map titles after
 * leftover-goals-kit. These routes are not hub labels; student chrome
 * stays sentence-case of the leftover Title-Case names. Routes stay.
 * leftover-fmea Failure log and leftover-pick-before Choose your team
 * stay. leftover-media Photos & video stays. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/cad-review-queue/cad-review-queue-client.tsx",
  "app/cad-review-queue/page.tsx",
  "lib/manifests/cad-review-queue.manifest.ts",
  "app/control-map/control-map-client.tsx",
  "app/control-map/page.tsx",
  "lib/control-map/control-map-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student CAD-map chrome", () => {
  it("does not print leftover CAD Review Queue / Control Map titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/CAD Review Queue/);
      expect(src, rel).not.toMatch(/Control Map/);
    }
    const queue = readFileSync(
      join(WEB, "app/cad-review-queue/cad-review-queue-client.tsx"),
      "utf8",
    );
    expect(queue).toMatch(/title="CAD review queue"/);
    expect(queue).toMatch(/feature="CAD review queue"/);
    const map = readFileSync(join(WEB, "app/control-map/control-map-client.tsx"), "utf8");
    expect(map).toMatch(/title="Control map"/);
    expect(map).toMatch(/feature="Control map"/);
    const related = readFileSync(join(WEB, "lib/control-map/control-map-related.ts"), "utf8");
    expect(related).toMatch(/Opening Control map/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).toMatch(/Open Failure log/);
    expect(related).toMatch(/Scan Failure log/);
    expect(related).not.toMatch(/Open FMEA/);
  });
});
