import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryShellCopy } from "../inventory/inventory-related";
import { decisionsShellCopy } from "../decisions/decisions-related";
import { logisticsShellCopy } from "../logistics/logistics-related";
import { retroShellCopy } from "../retro/retro-related";
import { connectionBadgeLabel, connectionsEmptyCopy } from "../account/connections-related";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover boards still hard-coded Setup required on EmptyState even after
 * related.ts said Needs setup (or still said Setup required). This family
 * now uses the shell-copy badge.
 */
const FILES = [
  "lib/inventory/inventory-related.ts",
  "lib/decisions/decisions-related.ts",
  "lib/logistics/logistics-related.ts",
  "lib/retro/retro-related.ts",
  "lib/account/connections-related.ts",
  "app/knowledge-gap/knowledge-gap-client.tsx",
  "app/pit/pit-command-client.tsx",
  "app/inventory/inventory-chrome.tsx",
  "app/decisions/decisions-client.tsx",
  "app/retro/retro-client.tsx",
] as const;

describe("leftover Needs setup student chrome", () => {
  it("does not print leftover Setup required on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
    }
  });

  it("setup badges stay Needs setup", () => {
    expect(inventoryShellCopy("setup").badge).toBe("Needs setup");
    expect(decisionsShellCopy("setup").badge).toBe("Needs setup");
    expect(logisticsShellCopy("setup").badge).toBe("Needs setup");
    expect(retroShellCopy("setup").badge).toBe("Needs setup");
    expect(connectionBadgeLabel("setup_required")).toBe("Needs setup");
    expect(connectionsEmptyCopy("setup").badge).toBe("Needs setup");
  });
});
