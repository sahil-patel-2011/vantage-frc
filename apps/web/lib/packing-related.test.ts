import { describe, expect, it } from "vitest";
import { PACKING_RELATED_INCLUDE, packingRelatedLinks } from "./packing-related";

describe("packingRelatedLinks", () => {
  it("hands off to consumables, the trip, and event readiness with orgId", () => {
    const links = packingRelatedLinks("org-1", { include: [...PACKING_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["spares", "logistics", "event-readiness"]);
    expect(links.find((link) => link.id === "spares")?.href).toBe("/spares?orgId=org-1");
    expect(links.find((link) => link.id === "logistics")?.href).toBe("/logistics?orgId=org-1");
    expect(links.find((link) => link.id === "event-readiness")?.href).toBe(
      "/event-readiness?orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(packingRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});
