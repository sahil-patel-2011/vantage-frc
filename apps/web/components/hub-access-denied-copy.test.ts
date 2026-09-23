import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HUB_SECTION_DENIED_COPY, HUB_TAB_DENIED_COPY } from "./hub-access-gate";

describe("hub access denial copy", () => {
  it("does not send a blocked member to Security", () => {
    expect(HUB_SECTION_DENIED_COPY).toBe(
      "Your access to this section is limited. An owner or admin can change that.",
    );
    expect(HUB_TAB_DENIED_COPY).toBe(
      "Your access to this section is limited. Pick another tab, or ask an owner or admin to change that.",
    );
    expect(HUB_SECTION_DENIED_COPY).not.toMatch(/Security/);
    expect(HUB_TAB_DENIED_COPY).not.toMatch(/Security/);
  });

  it("uses that note on the hub, Business, and Media shells", () => {
    const root = join(__dirname, "..");
    const files = [
      "components/product-hub.tsx",
      "app/business/business-client.tsx",
      "app/media/media-client.tsx",
      "components/hub-access-gate.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/Team → Security/);
    }
  });
});
