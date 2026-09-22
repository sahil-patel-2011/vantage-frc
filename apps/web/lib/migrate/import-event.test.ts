import { describe, expect, it } from "vitest";
import { initialImportEventMode, resolveImportEventKey } from "./import-event";

const ACTIVE = "2026custom-org-pacific";

describe("initialImportEventMode", () => {
  it("requires the active event for QRScout scans", () => {
    expect(initialImportEventMode({ required: true, activeKey: ACTIVE })).toBe("active");
  });

  it("leaves optional filters open to every event in the file", () => {
    expect(initialImportEventMode({ required: false, activeKey: ACTIVE })).toBe("all");
  });

  it("asks for a key when the team has no active event", () => {
    expect(initialImportEventMode({ required: true, activeKey: null })).toBe("other");
    expect(initialImportEventMode({ required: false, activeKey: "  " })).toBe("other");
  });
});

describe("resolveImportEventKey", () => {
  it("posts the active key, a typed key, or no filter", () => {
    expect(
      resolveImportEventKey({ mode: "active", activeKey: ACTIVE, typedKey: "2025mokc" }),
    ).toBe(ACTIVE);
    expect(
      resolveImportEventKey({ mode: "other", activeKey: ACTIVE, typedKey: " 2025mokc " }),
    ).toBe("2025mokc");
    expect(resolveImportEventKey({ mode: "all", activeKey: ACTIVE, typedKey: "2025mokc" })).toBe("");
  });
});
