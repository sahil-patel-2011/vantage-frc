import { describe, expect, it } from "vitest";
import {
  isWebCadAgentTool,
  parseCadAgentAction,
  WEB_CAD_AGENT_INSTRUCTIONS,
} from "../src/cad-agent-action";
import { onshapeDocumentOpenUrl, parseOnshapeDocumentUrl, resolveOnshapeBind } from "../src/onshape-url";

describe("parseOnshapeDocumentUrl", () => {
  it("parses Claude-CodeCad documents/w/e links", () => {
    const parsed = parseOnshapeDocumentUrl(
      "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc",
    );
    expect(parsed).toMatchObject({
      documentId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      elementId: "cccccccccccccccccccccccc",
    });
    expect(onshapeDocumentOpenUrl(parsed)).toContain("/w/bbbb");
  });

  it("accepts a documents/<id> link and notes the missing workspace", () => {
    const parsed = parseOnshapeDocumentUrl("https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(parsed.documentId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(parsed.workspaceId).toBe("");
    expect(parsed.note).toMatch(/workspace/i);
  });

  it("rejects non-Onshape URLs", () => {
    expect(() => parseOnshapeDocumentUrl("https://example.com/not-cad")).toThrow(/Onshape document URL/i);
  });

  it("fills missing workspace and Part Studio from the Onshape account", async () => {
    const http = async (path: string) => {
      if (path.startsWith("/documents?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "aaaaaaaaaaaaaaaaaaaaaaaa",
                name: "Plate",
                defaultWorkspace: { id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.includes("/elements")) {
        return new Response(
          JSON.stringify([{ id: "cccccccccccccccccccccccc", name: "Part Studio 1", elementType: "PARTSTUDIO" }]),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };
    const bound = await resolveOnshapeBind("https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa", http);
    expect(bound.workspaceId).toBe("bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(bound.elementId).toBe("cccccccccccccccccccccccc");
    expect(bound.documentName).toBe("Plate");
  });
});

describe("parseCadAgentAction", () => {
  it("parses Claude-CodeCad tool hops and finals", () => {
    expect(parseCadAgentAction('{"tool":"onshape_sketch_rectangle","arguments":{"widthMm":40,"heightMm":20}}')).toEqual({
      type: "tool_call",
      tool: "onshape_sketch_rectangle",
      input: { widthMm: 40, heightMm: 20 },
    });
    expect(parseCadAgentAction('{"final":"Bound. Send a millimetre brief."}')).toEqual({
      type: "final",
      answer: "Bound. Send a millimetre brief.",
    });
  });

  it("parses fenced autonomous-agent JSON", () => {
    expect(
      parseCadAgentAction('```json\n{"type":"tool_call","tool":"onshape_extrude","input":{"depthMm":10}}\n```'),
    ).toEqual({
      type: "tool_call",
      tool: "onshape_extrude",
      input: { depthMm: 10 },
    });
  });

  it("allowlists hosted Onshape tools only", () => {
    expect(isWebCadAgentTool("onshape_extrude")).toBe(true);
    expect(isWebCadAgentTool("fusion_extrude")).toBe(false);
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/Onshape/);
  });
});
