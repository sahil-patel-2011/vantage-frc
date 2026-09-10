import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = ["business-client.tsx", "business-panels.tsx"]
  .map((name) => readFileSync(join(__dirname, name), "utf8"))
  .join("\n");

describe("Business Budget honesty", () => {
  it("loads budget-vs-actual instead of inventing a DEMO spend %", () => {
    expect(source).toContain("/api/finance/budget-vs-actual");
    expect(source).toContain("describeBudgetLine");
    expect(source).toContain("Budget vs recorded spend");
    expect(source).not.toMatch(/never (a )?DEMO|never invents?\b/i);
    expect(source).not.toMatch(/Math\.random\(/);
  });
});
