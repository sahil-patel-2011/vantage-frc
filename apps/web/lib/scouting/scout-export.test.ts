import { describe, expect, it, vi } from "vitest";
import { loadMatchScoutingExport, matchScoutingCsv, scoutAnswerText } from "./scout-export";

describe("matchScoutingCsv", () => {
  const fields = [
    { key: "section", label: "Auto", type: "section_header" as const },
    { key: "autoPoints", label: "Auto points", type: "counter" as const },
    { key: "endgame", label: "Endgame", type: "select" as const },
    { key: "moved", label: "Left the line", type: "boolean" as const },
  ];

  it("writes one row per report with each answer under its question", () => {
    const csv = matchScoutingCsv({
      fields,
      rows: [
        {
          matchKey: "2026gacmp_qm1",
          teamKey: "frc195",
          scoutName: "Riley",
          confidence: "high",
          payload: { autoPoints: 12, endgame: "climb", moved: true, legacyNote: "=cmd" },
          savedAt: "2026-09-26 14:02 UTC",
        },
        { matchKey: "2026gacmp_qm2", teamKey: "frc118", scoutName: null, confidence: null, payload: {}, savedAt: null },
      ],
    });
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Match,Team,Scout,Auto points,Endgame,Left the line,legacyNote,How sure,Saved at");
    expect(lines[1]).toBe("Qual 1,195,Riley,12,Climb,Yes,'=cmd,Very sure,2026-09-26 14:02 UTC");
    expect(lines[2]).toBe("Qual 2,118,Team scout,,,,,,");
    expect(lines).toHaveLength(3);
  });

  it("reads lists and blanks plainly", () => {
    expect(scoutAnswerText(["swerve", "tank"])).toBe("Swerve; Tank");
    expect(scoutAnswerText(null)).toBe("");
    expect(scoutAnswerText(-2)).toBe(-2);
  });
});

describe("loadMatchScoutingExport", () => {
  it("scopes both reads to the team with parameters", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        if (calls.length === 1) {
          return {
            rows: [
              { matchKey: "e_qm1", teamKey: "frc1", scoutName: "A", confidence: "normal", payload: { x: 1 }, savedAt: null, schemaId: "s1" },
            ],
          };
        }
        return { rows: [{ definition: { fields: [{ key: "x", label: "X", type: "number" }] } }] };
      }),
    } as unknown as import("@neondatabase/serverless").PoolClient;
    const out = await loadMatchScoutingExport(client, { orgId: "org", eventKey: "e" });
    expect(calls[0]?.values).toEqual(["org", "e"]);
    expect(calls[1]?.values).toEqual(["org", ["s1"]]);
    expect(out.fields).toEqual([{ key: "x", label: "X", type: "number" }]);
    expect(out.rows[0]).not.toHaveProperty("schemaId");
  });
});
