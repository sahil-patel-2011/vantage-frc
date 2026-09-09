import type { PoolClient } from "@neondatabase/serverless";
import { afterEach, describe, expect, it } from "vitest";
import {
  cotsCatalogInstalled,
  loadCotsCatalogFromDb,
  lookupCotsPart,
  normalizeKey,
  registerCotsCatalog,
} from "./cots";
import { assemblyShadedViewPath, partShadedViewPath, renderStep, renderWholeAssembly } from "./render";

afterEach(() => registerCotsCatalog(null));

describe("lookupCotsPart", () => {
  it("returns null with no catalog installed, so hardware falls back to the CAD name", () => {
    expect(cotsCatalogInstalled()).toBe(false);
    expect(lookupCotsPart("10-32 x 1.00 SHCS")).toBeNull();
  });

  it("returns a hit when the catalog has one", () => {
    registerCotsCatalog(() => ({ name: "10-32 x 1.00 SHCS", vendor: "McMaster", sku: "91251A537" }));
    expect(lookupCotsPart("10-32 x 1.00 SHCS")).toEqual({
      name: "10-32 x 1.00 SHCS",
      vendor: "McMaster",
      sku: "91251A537",
    });
  });

  it("rejects a half-populated entry, because a blank SKU is not a sourcing decision", () => {
    registerCotsCatalog(() => ({ name: "Screw", vendor: "", sku: "X" }));
    expect(lookupCotsPart("Screw")).toBeNull();
  });

  it("never lets a broken catalog take the run down", () => {
    registerCotsCatalog(() => {
      throw new Error("catalog exploded");
    });
    expect(lookupCotsPart("Screw")).toBeNull();
  });

  it("ignores an empty query", () => {
    registerCotsCatalog(() => ({ name: "n", vendor: "v", sku: "s" }));
    expect(lookupCotsPart("   ")).toBeNull();
  });
});

describe("normalizeKey", () => {
  it("strips the Onshape instance suffix and collapses separators", () => {
    expect(normalizeKey("10-32 x 1.00 SHCS <3>")).toBe("10-32 x 1.00 shcs");
    expect(normalizeKey('1/2" hex shaft')).toBe("1/2 hex shaft");
  });

  it("keeps lengths distinct — two bolts differing by one character are two bolts", () => {
    expect(normalizeKey("8-32 x 1.00")).not.toBe(normalizeKey("8-32 x 1.50"));
  });
});

function catalogClient(tables: string[], columns: string[], rows: unknown[]): PoolClient {
  return {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("to_regclass")) {
        const name = values[0] as string;
        return { rows: [{ present: tables.includes(name) ? `public.${name}` : null }], rowCount: 1 };
      }
      if (sql.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      return { rows, rowCount: rows.length };
    },
  } as unknown as PoolClient;
}

describe("loadCotsCatalogFromDb", () => {
  it("returns null when the catalog table has not been migrated", async () => {
    expect(await loadCotsCatalogFromDb(catalogClient([], [], []))).toBeNull();
  });

  it("returns null when the table exists but is not the shape we can read", async () => {
    const client = catalogClient(["parts_catalog_ref"], ["id", "description"], []);
    expect(await loadCotsCatalogFromDb(client)).toBeNull();
  });

  it("indexes by name, SKU and alias when the catalog is there", async () => {
    const client = catalogClient(
      ["parts_catalog_ref"],
      ["name", "vendor", "sku", "aliases"],
      [{ name: "10-32 x 1.00 SHCS", vendor: "McMaster", sku: "91251A537", aliases: ["10-32x1 SHCS"] }],
    );
    const catalog = (await loadCotsCatalogFromDb(client))!;
    expect(catalog).not.toBeNull();
    expect(catalog("10-32 x 1.00 SHCS <2>")!.sku).toBe("91251A537");
    expect(catalog("91251A537")!.vendor).toBe("McMaster");
    expect(catalog("10-32x1 SHCS")!.sku).toBe("91251A537");
    expect(catalog("something else entirely")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("shaded-view paths", () => {
  it("builds an assembly view with the iso matrix and a fitted frame", () => {
    const path = assemblyShadedViewPath({ documentId: "D", workspaceId: "W", elementId: "E" });
    expect(path.startsWith("/assemblies/d/D/w/W/e/E/shadedviews?")).toBe(true);
    expect(path).toContain("pixelSize=0");
    expect(path).toContain("viewMatrix=");
  });

  it("builds a part view against the right workspace or microversion", () => {
    expect(
      partShadedViewPath({ documentId: "D", wvm: "m", wvmId: "MV", elementId: "E", partId: "P" }),
    ).toContain("/parts/d/D/m/MV/e/E/partid/P/shadedviews?");
  });

  it("refuses an absurd render size rather than asking Onshape for it", () => {
    expect(() =>
      assemblyShadedViewPath({ documentId: "D", workspaceId: "W", elementId: "E" }, { widthPx: 9000 }),
    ).toThrow(/between 32 and 2000/);
  });
});

describe("renderStep", () => {
  const assembly = { documentId: "D", workspaceId: "W", elementId: "E" };
  const part = { documentId: "D", wvm: "w" as const, wvmId: "W", elementId: "EL", partId: "P" };

  it("labels a placeholder instead of substituting a picture when everything fails", async () => {
    const http = async () => new Response("no", { status: 500 });
    const result = await renderStep({
      http,
      assembly,
      hiddenInstanceIds: ["A"],
      part,
      partName: "Gearbox plate",
      fullAssemblyPng: null,
    });
    expect(result.pngBase64).toBeNull();
    expect(result.mode).toBe("none");
    expect(result.note).toContain("No Onshape render for this step");
    expect(result.note).toContain("Open the assembly in Onshape");
  });

  it("falls back to the whole-assembly render and says that is what it is", async () => {
    const http = async () => new Response("no", { status: 500 });
    const result = await renderStep({
      http,
      assembly,
      hiddenInstanceIds: ["A"],
      part,
      partName: "Gearbox plate",
      fullAssemblyPng: "Zm9v",
    });
    expect(result.mode).toBe("assembly_full");
    expect(result.note).toContain("Shows the complete assembly, not this step");
  });

  it("stops trying the hidden-occurrence POST once it has been refused", async () => {
    const methods: string[] = [];
    const http = async (_path: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return new Response("no", { status: 400 });
    };
    const first = await renderStep({
      http,
      assembly,
      hiddenInstanceIds: ["A"],
      part: null,
      partName: "x",
      fullAssemblyPng: null,
    });
    expect(first.hiddenOccurrencesSupported).toBe(false);
    expect(methods).toContain("POST");

    methods.length = 0;
    await renderStep({
      http,
      assembly,
      hiddenInstanceIds: ["A"],
      part: null,
      partName: "x",
      fullAssemblyPng: null,
      tryHiddenOccurrences: false,
    });
    expect(methods).not.toContain("POST");
  });

  it("says an instance with no resolvable part has no part view", async () => {
    const http = async () => new Response("no", { status: 500 });
    const result = await renderStep({
      http,
      assembly,
      hiddenInstanceIds: [],
      part: null,
      partName: "Sub-assembly",
      fullAssemblyPng: null,
    });
    expect(result.note).toContain("does not resolve to a single Part Studio part");
  });
});

describe("renderWholeAssembly", () => {
  it("reports the reason rather than returning an empty image", async () => {
    const result = await renderWholeAssembly(async () => new Response("no", { status: 403 }), {
      documentId: "D",
      workspaceId: "W",
      elementId: "E",
    });
    expect(result.pngBase64).toBeNull();
    expect(result.mode).toBe("none");
    expect(result.note).toContain("Onshape returned no shaded view of the finished assembly");
  });
});
