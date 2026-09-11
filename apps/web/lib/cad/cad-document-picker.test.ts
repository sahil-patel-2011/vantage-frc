import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAD_DOCUMENT_BIND,
  CAD_PASTE_LINK_LABEL,
  ONSHAPE_STUDENT_PERMISSIONS,
  bindOnshapeDocumentUrl,
  cadOpenHref,
  onshapePickerUrl,
  parsePastedOnshapeLink,
} from "./cad-document-picker";
import { expectPlainCopy } from "../ui/copy-assertions";

const ORG = "11111111-1111-4111-8111-111111111111";
const LIVE_URL = "https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("student CAD document picker copy", () => {
  it("never names OAuth, env vars, or CLI commands", () => {
    expectPlainCopy(ONSHAPE_STUDENT_PERMISSIONS);
    expectPlainCopy(CAD_PASTE_LINK_LABEL);
    expect(ONSHAPE_STUDENT_PERMISSIONS).not.toMatch(/OAuth|CLIENT_SECRET|ONSHAPE_|vantage-cad/i);
    expect(CAD_DOCUMENT_BIND).toBe("Use this document");
  });
});

describe("onshapePickerUrl", () => {
  it("builds a Part Studio URL only from real ids", () => {
    expect(onshapePickerUrl("aaa111", "bbb222", "ccc333")).toBe(LIVE_URL);
    expect(onshapePickerUrl("aaa111", "bbb222")).toBe("https://cad.onshape.com/documents/aaa111/w/bbb222");
    expect(onshapePickerUrl("aaa111")).toBe("https://cad.onshape.com/documents/aaa111");
    expect(onshapePickerUrl("")).toBe("");
  });
});

describe("parsePastedOnshapeLink", () => {
  it("reads document, workspace, and element from a Part Studio link", () => {
    expect(parsePastedOnshapeLink(LIVE_URL)).toEqual({
      url: LIVE_URL,
      documentId: "aaa111",
      workspaceId: "bbb222",
      elementId: "ccc333",
    });
  });

  it("refuses DEMO links and empty paste", () => {
    expect(() => parsePastedOnshapeLink("")).toThrow(/Paste an Onshape/i);
    expect(() => parsePastedOnshapeLink("https://cad.onshape.com/documents/demo-doc")).toThrow(/demo/i);
    expect(() => parsePastedOnshapeLink("https://example.com/not-onshape")).toThrow(/Not an Onshape/i);
  });
});

describe("bindOnshapeDocumentUrl", () => {
  it("POSTs bind with the pasted URL and never invents ids", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body).toEqual({ orgId: ORG, action: "bind", url: LIVE_URL });
      return Response.json({ saved: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(bindOnshapeDocumentUrl({ orgId: ORG, url: LIVE_URL })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("asks to choose a team when orgId is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(bindOnshapeDocumentUrl({ orgId: "", url: LIVE_URL })).resolves.toEqual({
      ok: false,
      error: "Choose your team first.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a hosted bind error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Onshape is not connected" }, { status: 400 })));
    await expect(bindOnshapeDocumentUrl({ orgId: ORG, url: LIVE_URL })).resolves.toEqual({
      ok: false,
      error: "Onshape is not connected",
    });
  });
});

describe("cadOpenHref", () => {
  it("opens CAD for the same team", () => {
    expect(cadOpenHref(ORG)).toBe(`/cad?orgId=${ORG}`);
  });
});
