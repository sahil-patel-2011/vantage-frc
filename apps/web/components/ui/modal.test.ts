import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Modal sheet variant", () => {
  it("exposes a bottom-sheet variant and description for pickers", () => {
    const source = readFileSync(join(import.meta.dirname, "modal.tsx"), "utf8");
    expect(source).toContain('variant?: "dialog" | "sheet"');
    expect(source).toContain("description?:");
    expect(source).toContain("styles.sheetOverlay");
    expect(source).toContain("FOCUSABLE");
    expect(source).toContain('e.key === "Escape"');
  });
});
