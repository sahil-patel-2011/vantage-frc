import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "cad-variable-table.tsx"), "utf8");

describe("CadVariableTable", () => {
  it("is a native Variables editor, not FeatureScript", () => {
    expect(source).toContain("Re-edit Onshape variables");
    expect(source).toContain("Update variable");
    expect(source).toContain("variableStudioElementId");
    expect(source).not.toMatch(/feature_script|FeatureScript source/i);
  });
});
