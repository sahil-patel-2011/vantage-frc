/**
 * Get-unstuck is worthless if a panicking student cannot find it. These lock the
 * registration: a tab under Build › Code, and the panic words in the palette.
 */
import { describe, expect, it } from "vitest";
import { commandCatalog, searchCommands } from "../nav/command-search";
import { hubById, hubNestedTabs, hubWorkbenchId } from "../nav/hubs";

const HREF = "/build?tab=troubleshoot";
const catalog = commandCatalog();

describe("Get-unstuck navigation", () => {
  it("lives under Build › Code and points at /troubleshoot", () => {
    const build = hubById("build");
    const tab = build.tabs.find((entry) => entry.id === "troubleshoot");
    expect(tab?.label).toBe("Get unstuck");
    expect(tab?.legacyHref).toBe("/troubleshoot");
    expect(hubWorkbenchId(build, "troubleshoot")).toBe("code");
    expect(hubNestedTabs(build, "code").map((entry) => entry.id)).toContain("troubleshoot");
  });

  it("is findable by the words a student types at 11pm", () => {
    const queries = [
      "won't deploy",
      "no comms",
      "roborio",
      "brownout",
      "can't connect",
      "help",
      "stuck",
      "blink code",
      "troubleshoot",
      "get unstuck",
      "no robot code",
    ];
    const misses = queries.filter(
      (query) => !searchCommands(query, catalog, { limit: 6 }).some((hit) => hit.href === HREF),
    );
    expect(misses, `palette misses: ${misses.join(", ")}`).toEqual([]);
  });

  it("does not steal the deploy log from someone searching for it", () => {
    expect(searchCommands("deploy log", catalog, { limit: 1 })[0]?.href).toBe(
      "/build?tab=code-deploy-log",
    );
  });
});
