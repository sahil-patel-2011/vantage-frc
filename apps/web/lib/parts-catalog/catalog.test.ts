import { describe, expect, it } from "vitest";
import { INVENTORY_CATEGORIES } from "../inventory";
import {
  CATALOG_CATEGORY_LABELS,
  inventoryCategoryFor,
  PARTS_CATALOG,
  searchCatalog,
  vendorSearchUrl,
} from "./catalog";

describe("parts catalog data", () => {
  it("has unique ids", () => {
    const ids = PARTS_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every category maps onto a legal inventory category, so Add to inventory cannot fail the CHECK", () => {
    for (const p of PARTS_CATALOG) {
      expect(INVENTORY_CATEGORIES as readonly string[], p.id).toContain(inventoryCategoryFor(p.category));
      expect(CATALOG_CATEGORY_LABELS[p.category]).toBeTruthy();
    }
  });

  it("carries no prices anywhere — the vendor page is the price", () => {
    for (const p of PARTS_CATALOG) {
      const text = `${p.name} ${p.spec} ${p.use}`;
      expect(text, p.id).not.toMatch(/\$\s?\d/);
    }
  });

  it("vendor links are https and carry the SKU when there is one", () => {
    for (const p of PARTS_CATALOG) {
      const url = vendorSearchUrl(p);
      expect(url.startsWith("https://"), p.id).toBe(true);
      if (p.sku) expect(url, p.id).toContain(encodeURIComponent(p.sku));
    }
  });
});

describe("searchCatalog", () => {
  it("finds by the words students type, not only by the formal name", () => {
    expect(searchCatalog("nyloc").map((p) => p.id)).toEqual(
      expect.arrayContaining(["nut-10-32-nyloc", "nut-1-4-20-nyloc"]),
    );
    expect(searchCatalog("hex bearing").some((p) => p.id === "bearing-1-2-hex-flanged")).toBe(true);
  });

  it("requires every term to match", () => {
    // "nyloc 1/4-20" must not return the 10-32 nyloc: both say nyloc, only one
    // says 1/4-20. (A screw whose `use` mentions nuts is allowed to match
    // "nut" — the text is honest about what it pairs with.)
    const ids = searchCatalog("nyloc 1/4-20").map((p) => p.id);
    expect(ids).toContain("nut-1-4-20-nyloc");
    expect(ids).not.toContain("nut-10-32-nyloc");
  });

  it("filters by category and returns everything for an empty query", () => {
    expect(searchCatalog("", "motor").every((p) => p.category === "motor")).toBe(true);
    expect(searchCatalog("")).toHaveLength(PARTS_CATALOG.length);
  });

  it("returns nothing, not a fallback, for a term the catalog does not have", () => {
    expect(searchCatalog("flux capacitor")).toEqual([]);
  });
});
