import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CadViewport } from "../../app/cad/cad-viewport";
import {
  loadShadedView,
  SHADED_VIEW_MISSING,
  SHADED_VIEW_UNAUTHORIZED,
  SHADED_VIEW_UNBOUND,
  shadedViewFromOnshape,
} from "./shaded-view";

/** 1×1 PNG — same fixture as packages/cad shaded-view mocks. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TINY_PNG_BYTES = Buffer.from(TINY_PNG, "base64");
const DATA_URL = `data:image/png;base64,${TINY_PNG_BYTES.toString("base64")}`;

function assertHonestEmpty(result: { status: string; message?: string }) {
  expect(result.status).toBe("empty");
  expect(JSON.stringify(result).toLowerCase()).not.toMatch(/demo|cube/);
}

describe("shadedViewFromOnshape", () => {
  it("turns raw shadedviews PNG bytes into a data URL", () => {
    const result = shadedViewFromOnshape({ bytes: TINY_PNG_BYTES });
    expect(result).toEqual({
      status: "ready",
      pngBase64: TINY_PNG_BYTES.toString("base64"),
      dataUrl: DATA_URL,
    });
    expect(result.status === "ready" && result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("accepts the Onshape { images: [base64] } body", () => {
    const result = shadedViewFromOnshape({ body: { images: [TINY_PNG] } });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dataUrl).toBe(DATA_URL);
    expect(result.pngBase64).toBe(TINY_PNG_BYTES.toString("base64"));
  });

  it("accepts JSON bytes of a shadedviews body", () => {
    const bytes = Buffer.from(JSON.stringify({ images: [TINY_PNG] }), "utf8");
    const result = shadedViewFromOnshape({ bytes });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dataUrl).toBe(DATA_URL);
  });

  it("returns empty on 401 and never a DEMO cube", () => {
    const result = shadedViewFromOnshape({
      status: 401,
      body: { images: [TINY_PNG] },
    });
    assertHonestEmpty(result);
    expect(result).toMatchObject({ status: "empty", message: SHADED_VIEW_UNAUTHORIZED, pngBase64: null });
  });

  it("returns empty when the body is missing", () => {
    const result = shadedViewFromOnshape({ status: 200 });
    assertHonestEmpty(result);
    expect(result).toMatchObject({ status: "empty", message: SHADED_VIEW_MISSING, pngBase64: null });
  });

  it("rejects a DEMO cube / SVG placeholder as not a PNG", () => {
    const cube = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="M180 320 L400 90 L620 320 Z"/></svg>`,
      "utf8",
    ).toString("base64");
    const result = shadedViewFromOnshape({ body: { images: [cube] } });
    assertHonestEmpty(result);
  });
});

describe("loadShadedView", () => {
  const doc = {
    documentId: "d1",
    workspaceId: "w1",
    elementId: "e1",
  };

  it("decodes a mock shadedviews HTTP body", async () => {
    const result = await loadShadedView(async () => {
      return new Response(JSON.stringify({ images: [TINY_PNG] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, doc);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dataUrl).toBe(DATA_URL);
  });

  it("stays empty on 401 from Onshape", async () => {
    const result = await loadShadedView(async () => {
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }, doc);
    assertHonestEmpty(result);
    expect(result.message).toBe(SHADED_VIEW_UNAUTHORIZED);
  });

  it("stays empty when no Part Studio is bound", async () => {
    const result = await loadShadedView(async () => {
      throw new Error("should not fetch");
    }, { documentId: "", workspaceId: "", elementId: "" });
    assertHonestEmpty(result);
    expect(result.message).toBe(SHADED_VIEW_UNBOUND);
  });
});

describe("CadViewport", () => {
  const png = TINY_PNG_BYTES.toString("base64");
  const onshapeUrl = "https://cad.onshape.com/documents/abc/w/def/e/ghi";

  function html(props: { pngBase64?: string | null; openUrl?: string | null; setupRequired?: boolean }) {
    return renderToStaticMarkup(createElement(CadViewport, props));
  }

  it("renders the PNG as an img data URL and never an iframe", () => {
    const markup = html({ pngBase64: png, openUrl: onshapeUrl });
    expect(markup).toContain(`src="data:image/png;base64,${png}"`);
    expect(markup).toContain("Open in Onshape");
    expect(markup).toMatch(/<a[^>]+target="_blank"/);
    expect(markup).not.toContain("<iframe");
  });

  it("shows an empty state plus Open in Onshape text link when there is no PNG", () => {
    const markup = html({ openUrl: onshapeUrl });
    expect(markup).toContain("No shaded view yet");
    expect(markup).toMatch(/<a[^>]+href="https:\/\/cad\.onshape\.com/);
    expect(markup).toMatch(/<a[^>]+target="_blank"/);
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toMatch(/<iframe[^>]*src=/);
  });

  it("refuses to treat an Onshape document URL as a PNG src", () => {
    const markup = html({ pngBase64: onshapeUrl, openUrl: onshapeUrl, setupRequired: true });
    expect(markup).toContain("Onshape setup required");
    expect(markup).not.toContain(`src="${onshapeUrl}"`);
    expect(markup).not.toContain("<iframe");
  });
});
