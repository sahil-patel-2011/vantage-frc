import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAD_TOOL_CATALOG,
  cadToolInputSchema,
  cadToolSupportMatrix,
  hostedCadToolNames,
} from "../src/cad-tool-catalog";
import {
  assertFusionRelayParity,
  FUSION_RELAY_IMPLEMENTED_OPERATIONS,
  fusionRelayImplements,
} from "../src/fusion-relay";

/**
 * The /cad tools panel promises "Onshape only" *before* the agent runs anything.
 * That promise is only worth having if "supported on Fusion" is checked against
 * what the add-in really executes — these tests are that check.
 */
describe("Fusion parity is a contract, not a claim", () => {
  it("every Fusion-supported tool names a relay operation the add-in implements", () => {
    const offenders = CAD_TOOL_CATALOG.filter(
      (tool) =>
        tool.fusion === "supported" &&
        tool.group !== "session" &&
        (!tool.fusionOperation || !fusionRelayImplements(tool.fusionOperation)),
    ).map((tool) => `${tool.name} -> ${tool.fusionOperation ?? "(none)"}`);
    expect(offenders).toEqual([]);
  });

  it("never declares a fusionOperation the add-in does not implement", () => {
    for (const tool of CAD_TOOL_CATALOG) {
      if (!tool.fusionOperation) continue;
      expect(
        fusionRelayImplements(tool.fusionOperation),
        `${tool.name} claims relay operation ${tool.fusionOperation}`,
      ).toBe(true);
    }
  });

  it("marks a tool unsupported on Fusion only with a note that explains why", () => {
    for (const tool of CAD_TOOL_CATALOG) {
      if (tool.fusion !== "unsupported") continue;
      expect(tool.fusionNote, `${tool.name} needs a fusionNote`).toBeTruthy();
    }
  });

  /**
   * The TS list and the Python add-in are two files that must not drift. Read the
   * add-in source and compare the literal IMPLEMENTED set.
   */
  it("matches the IMPLEMENTED set in the Fusion add-in source", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../fusion360-official-connector/VantageCadRelay/VantageCadRelay.py",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const block = source.match(/^IMPLEMENTED = \{([\s\S]*?)^\}/m);
    expect(block, "IMPLEMENTED set not found in VantageCadRelay.py").toBeTruthy();
    const inAddin = [...block![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!).sort();
    expect(inAddin).toEqual([...FUSION_RELAY_IMPLEMENTED_OPERATIONS].sort());
  });
});

describe("assertFusionRelayParity", () => {
  it("reports an add-in that is missing operations this build expects", () => {
    const result = assertFusionRelayParity(["create_sketch", "create_extrude"]);
    expect(result.known).toBe(true);
    expect(result.inSync).toBe(false);
    expect(result.missingFromAddin).toContain("create_fillet");
    expect(result.note).toContain("vantage-cad update");
  });

  it("is in sync when the add-in advertises exactly this build's operations", () => {
    const result = assertFusionRelayParity([...FUSION_RELAY_IMPLEMENTED_OPERATIONS]);
    expect(result.inSync).toBe(true);
    expect(result.missingFromAddin).toEqual([]);
    expect(result.extraInAddin).toEqual([]);
  });

  it("flags a newer add-in rather than silently accepting it", () => {
    const result = assertFusionRelayParity([...FUSION_RELAY_IMPLEMENTED_OPERATIONS, "create_loft"]);
    expect(result.inSync).toBe(false);
    expect(result.extraInAddin).toEqual(["create_loft"]);
  });

  it("says 'unknown', not 'in sync', for a pre-0.2.0 add-in that reports nothing", () => {
    const result = assertFusionRelayParity(undefined);
    expect(result.known).toBe(false);
    expect(result.inSync).toBe(false);
    expect(result.note).toContain("vantage-cad update");
  });
});

describe("catalog shape", () => {
  it("has unique tool names", () => {
    const names = CAD_TOOL_CATALOG.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds a JSON schema whose required list only names declared params", () => {
    for (const tool of CAD_TOOL_CATALOG) {
      const schema = cadToolInputSchema(tool) as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      for (const name of schema.required ?? []) {
        expect(Object.keys(schema.properties)).toContain(name);
      }
    }
  });

  it("keeps every fusion_* tool out of the hosted (Vercel) agent allowlist", () => {
    expect(hostedCadToolNames().filter((name) => name.startsWith("fusion_"))).toEqual([]);
  });

  it("exposes fusionOperation through the UI support matrix", () => {
    const fillet = cadToolSupportMatrix().find((tool) => tool.name === "onshape_fillet");
    expect(fillet?.fusionOperation).toBe("create_fillet");
    expect(fillet?.fusionNote).toContain("Onshape only");
  });
});
