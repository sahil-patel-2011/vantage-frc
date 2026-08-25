import { describe, expect, it } from "vitest";
import { cadAgentOpenUrl } from "./cad-agent-session";

describe("cad agent session", () => {
  it("builds the Onshape open URL from a bound Part Studio", () => {
    expect(
      cadAgentOpenUrl({
        documentId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb",
        elementId: "cccccccccccccccccccccccc",
      }),
    ).toBe(
      "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc",
    );
    expect(cadAgentOpenUrl({})).toBeNull();
  });
});
