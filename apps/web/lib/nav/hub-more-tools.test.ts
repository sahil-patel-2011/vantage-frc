import { describe, expect, it } from "vitest";
import { hubMoreTools } from "./hub-more-tools";
import { hubNavigationSections } from "./hub-navigation";
import { hubById, PRODUCT_HUBS } from "./hubs";

const everything = () => true;
const onRow = (hubId: Parameters<typeof hubById>[0]) => {
  const hub = hubById(hubId);
  return new Set(hubNavigationSections(hub, hub.tabs).map((section) => section.id));
};

describe("hub more tools", () => {
  it("lists the tools taken off Competition's section row under their sections", () => {
    const groups = hubMoreTools(hubById("competition"), onRow("competition"), everything);
    const byGroup = Object.fromEntries(groups.map((group) => [group.id, group.tools.map((tool) => tool.id)]));
    expect(byGroup.scouting).toEqual(expect.arrayContaining(["forms", "scout-coverage-live"]));
    expect(byGroup.command).toContain("my-day");
    expect(byGroup["match-checklist"]).toContain("pit-tv");
    expect(groups.find((group) => group.id === "scouting")?.label).toBe("Scout");
  });

  it("never repeats a section link, a hidden tool, or a second door to the same page", () => {
    for (const hub of PRODUCT_HUBS) {
      const row = onRow(hub.id);
      const tools = hubMoreTools(hub, row, everything).flatMap((group) => group.tools);
      expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
      expect(new Set(tools.map((tool) => tool.label)).size, hub.id).toBe(tools.length);
      for (const tool of tools) {
        expect(row.has(tool.id)).toBe(false);
        const tab = hub.tabs.find((entry) => entry.id === tool.id);
        expect(tab?.inStrip).not.toBe(false);
        expect(tab?.inSearch).not.toBe(false);
      }
    }
  });

  it("links every tool through its hub tab so access checks still apply", () => {
    const tools = hubMoreTools(hubById("build"), onRow("build"), everything).flatMap((group) => group.tools);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.href).toBe(`/build?tab=${tool.id}`);
  });

  it("drops a whole section the member cannot open, and single tools they cannot open", () => {
    const hub = hubById("competition");
    const noStrategy = hubMoreTools(hub, onRow("competition"), (href) => !href.endsWith("tab=strategy"));
    expect(noStrategy.some((group) => group.id === "strategy")).toBe(false);
    const noMyDay = hubMoreTools(hub, onRow("competition"), (href) => !href.endsWith("tab=my-day"));
    expect(noMyDay.flatMap((group) => group.tools).some((tool) => tool.id === "my-day")).toBe(false);
  });
});
