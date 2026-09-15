import { describe, expect, it } from "vitest";
import { annotateToolOutput, createVantageToolRegistry, planChatToolCalls, toolUsesOrgData } from "../src";

describe("frc.fundamentals agent tool", () => {
  it("registers a non-org-data tool that returns the 2026 REBUILT pack", async () => {
    expect(toolUsesOrgData("frc.fundamentals")).toBe(false);
    const names = createVantageToolRegistry().list().map((tool) => tool.name);
    expect(names).toContain("frc.fundamentals");
    const output = await createVantageToolRegistry().invoke(
      "frc.fundamentals",
      {
        client: {} as never,
        orgId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        activeEventKey: null,
      },
      { seasonYear: 2026 },
    );
    expect(output).toEqual(
      expect.objectContaining({
        seasonYear: 2026,
        currentGame: expect.objectContaining({
          year: 2026,
          gameName: "REBUILT",
          status: "published",
        }),
      }),
    );
    const annotated = annotateToolOutput("frc.fundamentals", output, { seasonYear: 2026 });
    expect(annotated.status).toBe("ok");
    expect(annotated.classification).toBe("researched_claim");
    expect(annotated.summary).toMatch(/REBUILT 2026/);
  });

  it("plans the tool for FRC orientation questions without inventing scoring", () => {
    const calls = planChatToolCalls("What is FRC and how does a match work?");
    expect(calls).toEqual(expect.arrayContaining([{ name: "frc.fundamentals", input: { seasonYear: expect.any(Number) } }]));
    expect(planChatToolCalls("Thanks — remind me how private memory works.")).toEqual([]);
  });

  it("locks seasonYear to the active event, not a year mentioned in chat", () => {
    const calls = planChatToolCalls("What is the current FRC game compared to 2025?", {
      capability: "strategy",
      activeEventKey: "2027nysu",
    });
    expect(calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "frc.fundamentals", input: { seasonYear: 2027 } })]),
    );
  });
});
