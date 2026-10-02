import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDefaultTab, flagsFromFundingModel } from "../../lib/funding-profile";
import { filterSponsorTabs, SPONSOR_TAB_IDS } from "../../lib/nav/hub-access-filter";
import { TABS, hasRecordedWorkingFunds, moneyWhenRecorded, recordedWorkingFundsCents, writeTabToUrl } from "./business-helpers";
import { URL_CHANGE_EVENT } from "../../lib/nav/url-change";

afterEach(() => vi.unstubAllGlobals());

describe("business funding-model hub chrome", () => {
  it("notifies shared navigation when a restricted deep-link falls back, preserving team and filters", () => {
    const target = new EventTarget();
    const notify = vi.fn();
    target.addEventListener(URL_CHANGE_EVENT, notify);
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href: "https://vantage.test/business?tab=sponsors&orgId=team&season=2026#summary" }, history: { replaceState }, dispatchEvent: target.dispatchEvent.bind(target) });
    writeTabToUrl("overview");
    expect(replaceState).toHaveBeenCalledWith({}, "", "/business?orgId=team&season=2026#summary");
    expect(notify).toHaveBeenCalledOnce();
  });
  it("hides sponsor workbenches when the school pays and sponsors are not allowed", () => {
    expect(flagsFromFundingModel("school_funded_no_sponsors").sponsorsAllowed).toBe(false);
    expect(businessDefaultTab("school_funded_no_sponsors")).toBe("finance");
    expect(filterSponsorTabs(TABS, false).map((tab) => tab.id)).toEqual([
      "overview",
      "finance",
      "budget",
      "orders",
      "grants",
      "evidence",
    ]);
    expect(SPONSOR_TAB_IDS.has("sponsors")).toBe(true);
    expect(SPONSOR_TAB_IDS.has("sponsorship")).toBe(true);
    expect(SPONSOR_TAB_IDS.has("placements")).toBe(true);
  });

  it("does not paint $0 as working funds when no budget or cash is recorded", () => {
    expect(hasRecordedWorkingFunds({ totalBudgetCents: 0, sponsorIncomeCents: 0, grantIncomeCents: 0 })).toBe(
      false,
    );
    expect(moneyWhenRecorded(0)).toBe("—");
    expect(recordedWorkingFundsCents({ totalBudgetCents: 0, sponsorIncomeCents: 25000, grantIncomeCents: 0 })).toBe(
      25000,
    );
  });
});
