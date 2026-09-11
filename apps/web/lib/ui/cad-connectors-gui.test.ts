/**
 * Source lock for CAD connectors GUI: Connectors + CAD connections + pair
 * chrome. The Onshape viewport worker owns cad-client / vault / learn /
 * setup-client — those files are not rewritten here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAD_DOCUMENT_BIND, CAD_PASTE_LINK_LABEL, ONSHAPE_STUDENT_PERMISSIONS } from "../cad/cad-document-picker";
import { CAD_PAIR_TITLE } from "../cad/cad-setup-copy";
import { connectorBadge } from "../connectors/actions";
import {
  CONNECTORS_PAGE_STUDENT_DESCRIPTION,
  connectorScopeNote,
  connectorsPageDescription,
  studentPermissionsCopy,
} from "../connectors/catalog";
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
  "lib/connectors/actions.ts",
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
    expect(picker).toMatch(/cad-document-picker.css/);
    expect(picker).not.toMatch(/CLIENT_SECRET|OAuth2Read|ONSHAPE_OAUTH|vantage-cad/);
    expect(CAD_PASTE_LINK_LABEL).toBe("Paste an Onshape link");
    expect(CAD_DOCUMENT_BIND).toBe("Use this document");
    expectPlainCopy(ONSHAPE_STUDENT_PERMISSIONS);
    expect(studentPermissionsCopy("onshape")).toBe(ONSHAPE_STUDENT_PERMISSIONS);
  });

  it("Connectors student chrome never dumps register URLs or env names", () => {
    const src = read("app/connectors/connectors-client.tsx");
    expect(src).toMatch(/connectorsPageDescription/);
    expect(src).toMatch(/connectorScopeNote/);
    expect(src).toMatch(/connectorAudienceFromRole/);
    expect(CONNECTORS_PAGE_STUDENT_DESCRIPTION).not.toMatch(/OAuth|CLIENT_SECRET|register with the provider|Vercel/i);
    expectPlainCopy(CONNECTORS_PAGE_STUDENT_DESCRIPTION);
    expect(connectorsPageDescription({ canManage: false, summary: "3 connected" })).not.toMatch(
      /register with the provider|OAuth|CLIENT_SECRET/,
    );
    expect(connectorsPageDescription({ canManage: true, summary: "3 connected" })).toMatch(
      /register with the provider/,
    );
    expect(connectorScopeNote("member", "student")).toBe("Personal — you connect your own account.");
    expect(connectorScopeNote("platform", "student")).toMatch(/ask a mentor/i);
    expect(connectorBadge("not_configured", "student").label).toBe("Needs setup");
    expect(connectorBadge("token_expired", "student").label).toBe("Reconnect");
    expect(connectorBadge("not_configured").label).toBe("Not configured");
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
    const connections = read("app/cad/connections/connections-client.tsx");
    const connectionsPage = read("app/cad/connections/page.tsx");
    expect(connections).toMatch(/Pair this computer/);
    expect(connectionsPage).toMatch(/badge="Needs setup"/);
    expect(connectionsPage).not.toMatch(/Setup required/);
  });

  it("does not dump OAuth or env names on this slice", () => {
    for (const rel of SLICE) {
      const src = read(rel);
      if (rel === "lib/connectors/catalog.ts") {
        expect(src, rel).toMatch(/studentPermissionsCopy/);
        expect(src, rel).toMatch(/CONNECTORS_PAGE_STUDENT_DESCRIPTION/);
        continue;
      }
      expect(src, rel).not.toMatch(/ONSHAPE_OAUTH_CLIENT_SECRET|CLIENT_SECRET|Onshape OAuth/);
    }
  });
});
