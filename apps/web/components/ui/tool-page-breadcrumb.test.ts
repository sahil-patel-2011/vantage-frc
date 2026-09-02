import { describe, expect, it } from "vitest";
import { toolPageBreadcrumb, toolPageBreadcrumbText } from "./tool-page-breadcrumb";

describe("toolPageBreadcrumb", () => {
  it("links the hub crumb to the workbench that owns the tool, not to the leaf", () => {
    expect(toolPageBreadcrumb("build", "cad-vault", { orgId: "org-1" })).toEqual([
      { label: "Build", href: "/build?tab=cad&orgId=org-1" },
      { label: "CAD vault" },
    ]);
  });

  it("keeps a workbench root pointing at itself", () => {
    expect(toolPageBreadcrumb("build", "fmea")).toEqual([
      { label: "Build", href: "/build?tab=fmea" },
      { label: "Robot" },
    ]);
  });

  it("lets a page override the current crumb label", () => {
    const crumbs = toolPageBreadcrumb("team", "fmea", { orgId: "org-2", toolLabel: "FMEA" });
    expect(crumbs).toEqual([
      { label: "Team", href: "/team?tab=todos&orgId=org-2" },
      { label: "FMEA" },
    ]);
  });

  it("never builds a dead link for an unknown tab id", () => {
    expect(toolPageBreadcrumb("team", "not-a-real-tab")).toEqual([
      { label: "Team", href: "/team?tab=calendar" },
      { label: "not-a-real-tab" },
    ]);
  });

  it("omits orgId from the href when none is known", () => {
    const [hub] = toolPageBreadcrumb("build", "power-budget", { orgId: null });
    expect(hub?.href).toBe("/build?tab=fmea");
  });

  it("renders as `Hub / Tool` text", () => {
    expect(toolPageBreadcrumbText(toolPageBreadcrumb("build", "robot"))).toBe("Build / Blueprint");
  });
});
