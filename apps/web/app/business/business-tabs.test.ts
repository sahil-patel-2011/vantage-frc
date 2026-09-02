import { describe, expect, it } from "vitest";
import { hubById, hubPrimaryTabs, isHubTab } from "../../lib/nav/hubs";
import { BUSINESS_EMBEDDED_TABS, isBusinessTab } from "./business-tabs";

describe("business embedded tabs", () => {
  const business = hubById("business");

  it("only names tabs the Business hub actually defines", () => {
    for (const id of BUSINESS_EMBEDDED_TABS) {
      expect(isHubTab(business, id), id).toBe(true);
    }
  });

  it("renders every workbench root inline so the TabBar never dead-ends", () => {
    for (const tab of hubPrimaryTabs(business)) {
      expect(isBusinessTab(tab.id), tab.id).toBe(true);
    }
  });

  it("rejects tabs that live on their own route", () => {
    expect(isBusinessTab("costs")).toBe(false);
    expect(isBusinessTab(null)).toBe(false);
  });
});
