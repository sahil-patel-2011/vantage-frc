import { describe, expect, it } from "vitest";
import {
  FREEBUFF_UNMETERED_DEFAULT,
  canonicalizeFreebuffModel,
  canonicalizeSelectableFreebuffModel,
  freebuffModelCatalog,
  freebuffPickerLabel,
  freebuffSelectableCatalog,
  isMeteredFreebuffModel,
  isUnmeteredFreebuffModel,
  resolveSelectableFreebuffModel,
  resolveUnmeteredFreebuffModel,
} from "../src/freebuff-models";

describe("freebuff unmetered allowlist", () => {
  it("defaults to DeepSeek V4 Flash and still accepts GLM and MiMo aliases", () => {
    expect(FREEBUFF_UNMETERED_DEFAULT).toBe("deepseek/deepseek-v4-flash");
    expect(canonicalizeFreebuffModel("deepseek")).toBe("deepseek/deepseek-v4-flash");
    expect(canonicalizeFreebuffModel("glm/glm-5.3-flash")).toBe("glm/glm-5.3-flash");
    expect(canonicalizeFreebuffModel("GLM-5.3-Flash")).toBe("glm/glm-5.3-flash");
    expect(canonicalizeFreebuffModel("mimo-2.5")).toBe("mimo/mimo-2.5");
    expect(canonicalizeFreebuffModel("mimo/mimo-2.5")).toBe("mimo/mimo-2.5");
    expect(freebuffModelCatalog().map((model) => model.slug)).toEqual([
      "deepseek/deepseek-v4-flash",
      "glm/glm-5.3-flash",
      "mimo/mimo-2.5",
    ]);
    expect(freebuffPickerLabel(freebuffModelCatalog()[0]!)).toBe(
      "DeepSeek V4 Flash — Free, unlimited, and fast request routing.",
    );
  });

  it("refuses unknown slugs and treats DeepSeek as unmetered", () => {
    expect(isUnmeteredFreebuffModel("deepseek/deepseek-v4-flash")).toBe(true);
    expect(isUnmeteredFreebuffModel("gpt-4.1-mini")).toBe(false);
    expect(canonicalizeFreebuffModel("gpt-4.1-mini")).toBeNull();
    expect(resolveUnmeteredFreebuffModel("gpt-4.1-mini")).toBe(FREEBUFF_UNMETERED_DEFAULT);
    expect(resolveUnmeteredFreebuffModel("freebuff")).toBe(FREEBUFF_UNMETERED_DEFAULT);
  });
});

describe("freebuff selectable picker", () => {
  it("accepts DeepSeek V4 Flash as the free default choice", () => {
    expect(canonicalizeSelectableFreebuffModel("deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
    expect(resolveSelectableFreebuffModel("deepseek/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
    expect(isMeteredFreebuffModel("deepseek/deepseek-v4-flash")).toBe(false);
    expect(isMeteredFreebuffModel("glm/glm-5.3-flash")).toBe(false);
    expect(freebuffSelectableCatalog().map((model) => model.slug)).toEqual([
      "deepseek/deepseek-v4-flash",
      "glm/glm-5.3-flash",
      "mimo/mimo-2.5",
    ]);
  });
});
