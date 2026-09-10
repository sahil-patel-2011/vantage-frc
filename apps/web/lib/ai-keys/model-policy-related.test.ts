import { describe, expect, it } from "vitest";
import {
  describeModelPolicy,
  FORCE_AUTO_SELECTOR_LABEL,
  MODEL_POLICY_MODE_META,
  sanitizeAllowedModelIds,
} from "./model-policy-related";

const catalog = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("sanitizeAllowedModelIds", () => {
  it("keeps only catalog ids in catalog order", () => {
    expect(sanitizeAllowedModelIds(["c", "a", "zzz"], catalog)).toEqual(["a", "c"]);
  });

  it("trims and dedupes", () => {
    expect(sanitizeAllowedModelIds([" a ", "a", "a"], catalog)).toEqual(["a"]);
  });

  it("handles null / empty input", () => {
    expect(sanitizeAllowedModelIds(null, catalog)).toEqual([]);
    expect(sanitizeAllowedModelIds([], catalog)).toEqual([]);
  });
});

describe("describeModelPolicy", () => {
  it("describes each mode honestly", () => {
    expect(describeModelPolicy("allow_all", 0)).toMatch(/All catalog models/);
    expect(describeModelPolicy("force_auto", 5)).toMatch(/Auto only/);
    expect(describeModelPolicy("allowlist", 0)).toMatch(/No models/);
    expect(describeModelPolicy("allowlist", 1)).toBe("1 model is allowed, plus Auto.");
    expect(describeModelPolicy("allowlist", 2)).toBe("2 models are allowed, plus Auto.");
  });
});

describe("mode metadata", () => {
  it("covers all three selection modes with labels", () => {
    expect(Object.keys(MODEL_POLICY_MODE_META).sort()).toEqual([
      "allow_all",
      "allowlist",
      "force_auto",
    ]);
    for (const meta of Object.values(MODEL_POLICY_MODE_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it("has a stable force-auto selector label", () => {
    expect(FORCE_AUTO_SELECTOR_LABEL).toBe("Auto (set by your team)");
  });
});
