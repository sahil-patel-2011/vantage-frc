/**
 * Source lock for CAD connectors GUI: Connectors + CAD connections + pair
 * chrome. The Onshape viewport worker owns cad-client / vault / learn /
 * setup-client — those files are not rewritten here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAD_DOCUMENT_BIND,
  CAD_PASTE_LINK_LABEL,
  ONSHAPE_STUDENT_PERMISSIONS,
} from "../cad/cad-document-picker";
import { CAD_PAIR_TITLE } from "../cad/cad-setup-copy";
import { studentPermissionsCopy } from "../connectors/catalog";
import { pairShellCopy } from "../editor/pair-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const SLICE = [
  "app/connectors/connectors-client.tsx",
  "app/cad/connections/connections-client.tsx",
  "app/cad/connections/cad-document-picker.tsx",
  "app/cad/connections/page.tsx",
  "app/cad/pair/pair-client.tsx",
  "app/cad/pair/page.tsx",
  "app/editor/pair/pair-client.tsx",
  "app/editor/pair/page.tsx",
  "lib/cad/cad-document-picker.ts",
  "lib/connectors/catalog.ts",
] as const;

function read(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("CAD connectors GUI student chrome", () => {
  it("Connectors and CAD connections keep last snapshot and Choose your team on 401/403", () => {
    for (const rel of [
      "app/connectors/connectors-client.tsx",
      "app/cad/connections/connections-client.tsx",
    ] as const) {
      const src = read(rel);
      expect(src, rel).toMatch(/putFeatureSnapshot\("/);
      expect(src, rel).toMatch(/getFeatureSnapshot/);
      expect(src, rel).toMatch(/hadCache \|\| viewRef\.current/);
      expect(src, rel).toMatch(/response\.status === 401 \|\| response\.status === 403/);
      expect(src, rel).toMatch(/Choose your team/);
      expect(src, rel).toMatch(/CadDocumentPicker/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/CLIENT_SECRET/);
    }
  });

  it("document picker is paste-link fallback with one Use this document primary", () => {
    const picker = read("app/cad/connections/cad-document-picker.tsx");
    expect(picker).toMatch(/CAD_PASTE_LINK_LABEL/);
    expect(picker).toMatch(/CAD_DOCUMENT_BIND/);
    expect(picker).toMatch(/listOnshapeDocuments/);
    expect(picker).not.toMatch(/CLIENT_SECRET|OAuth2Read|ONSHAPE_OAUTH|vantage-cad/);
    expect(CAD_PASTE_LINK_LABEL).toBe("Paste an Onshape link");
    expect(CAD_DOCUMENT_BIND).toBe("Use this document");
    expectPlainCopy(ONSHAPE_STUDENT_PERMISSIONS);
    expect(studentPermissionsCopy("onshape")).toBe(ONSHAPE_STUDENT_PERMISSIONS);
  });

  it("Pair this computer and Pair VS Code keep Team picker and fixture headings", () => {
    const cadPair = read("app/cad/pair/pair-client.tsx");
    const cadPage = read("app/cad/pair/page.tsx");
    const vsPair = read("app/editor/pair/pair-client.tsx");
    const vsPage = read("app/editor/pair/page.tsx");
    expect(CAD_PAIR_TITLE).toBe("Pair this computer");
    expect(cadPair).toMatch(/<h1>\{CAD_PAIR_TITLE\}<\/h1>/);
    expect(cadPair).toMatch(/<label>\s*Team\s*<select/s);
    expect(cadPair).toMatch(/Choose your team/);
    expect(cadPage).not.toMatch(/redirect\(\s*["']\/signin/);
    expect(vsPair).toMatch(/title="Pair VS Code"/);
    expect(vsPair).toMatch(/<FormRow label="Team">/);
    expect(vsPage).not.toMatch(/redirect\(\s*["']\/signin/);
    expect(pairShellCopy("setup").badge).toBe("Needs setup");
    expect(pairShellCopy("setup").title).toBe("Choose your team");
    expect(vsPair).not.toMatch(/Organization \/ workspace/);
    expect(cadPair).not.toMatch(/Organization \/ workspace/);
  });

  it("does not dump OAuth or env names on this slice", () => {
    for (const rel of SLICE) {
      const src = read(rel);
      if (rel === "lib/connectors/catalog.ts") {
        expect(src, rel).toMatch(/studentPermissionsCopy/);
        continue;
      }
      expect(src, rel).not.toMatch(/ONSHAPE_OAUTH_CLIENT_SECRET|CLIENT_SECRET|Onshape OAuth/);
    }
  });
});
