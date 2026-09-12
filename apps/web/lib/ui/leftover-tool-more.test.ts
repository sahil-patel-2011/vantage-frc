import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Tool Checkout / Training Matrix / Vendor Directory
 * titles after leftover-build-more. Hub labels stay Tool checkout,
 * Training matrix, and Vendor directory. leftover-offline feature
 * Training / Vendors stay. leftover-fmea Failure log, leftover-fmea-strips
 * no Open FMEA, leftover-pick Choose your team, leftover-invites Invites,
 * leftover-visit-invites Visit invites, leftover-community-impact Impact,
 * leftover-event-day-more Event day, leftover-ops-more Skills / Risk
 * register / Burndown, leftover-build-more Parts relay / Subsystem
 * sign-off stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/tool-checkout/tool-checkout-client.tsx",
  "app/tool-checkout/page.tsx",
  "lib/tool-checkout/tool-checkout-related.ts",
  "app/training/training-client.tsx",
  "app/training/page.tsx",
  "app/vendors/vendors-client.tsx",
  "app/vendors/page.tsx",
  "lib/vendors/vendors-related.ts",
  "lib/vendors/compute-vendors.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student tool-more chrome", () => {
  it("does not print leftover Tool Checkout / Training Matrix titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Tool Checkout/);
      expect(src, rel).not.toMatch(/Training Matrix/);
      expect(src, rel).not.toMatch(/Vendor Directory/);
    }
    const tools = readFileSync(join(WEB, "app/tool-checkout/tool-checkout-client.tsx"), "utf8");
    expect(tools).toMatch(/title="Tool checkout"/);
    expect(tools).toMatch(/feature="Tool checkout"/);
    expect(tools).not.toMatch(/title="Loading/);
    const training = readFileSync(join(WEB, "app/training/training-client.tsx"), "utf8");
    expect(training).toMatch(/title="Training matrix"/);
    expect(training).toMatch(/feature="Training"/);
    expect(training).toMatch(/Opening Training matrix/);
    expect(training).not.toMatch(/title="Loading/);
    const vendors = readFileSync(join(WEB, "app/vendors/vendors-client.tsx"), "utf8");
    expect(vendors).toMatch(/title="Vendor directory"/);
    expect(vendors).toMatch(/feature="Vendors"/);
    expect(vendors).not.toMatch(/title="Loading/);
    const toolRelated = readFileSync(
      join(WEB, "lib/tool-checkout/tool-checkout-related.ts"),
      "utf8",
    );
    expect(toolRelated).toMatch(/Opening Tool checkout/);
    expect(toolRelated).not.toMatch(/title="Loading/);
    expect(toolRelated).toMatch(/Choose your team/);
    expect(toolRelated).not.toMatch(/\bPick a team\b/);
    const vendorRelated = readFileSync(join(WEB, "lib/vendors/vendors-related.ts"), "utf8");
    expect(vendorRelated).toMatch(/Opening Vendor directory/);
    expect(vendorRelated).not.toMatch(/title="Loading/);
    expect(vendorRelated).toMatch(/Choose your team/);
    expect(vendorRelated).toMatch(/Open Lead times/);
    expect(vendorRelated).not.toMatch(/\bPick a team\b/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/tool-checkout"\)\) return "Tool checkout"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/training"\)\) return "Training"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/vendors"\)\) return "Vendors"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/parts-relay"\)\) return "Parts relay"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/subsystem-signoff"\)\) return "Subsystem sign-off"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/team\/admin"\)\) return "Invites"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/visit-invites"\)\) return "Visit invites"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact"\)\) return "Impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/fmea"\)\) return "Failure log"/);
  });
});
