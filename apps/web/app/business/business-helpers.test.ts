import { describe, expect, it } from "vitest";
import { businessDefaultTab, flagsFromFundingModel } from "../../lib/funding-profile";
import { filterSponsorTabs, SPONSOR_TAB_IDS } from "../../lib/nav/hub-access-filter";
import { TABS, hasRecordedWorkingFunds, moneyWhenRecorded, recordedWorkingFundsCents } from "./business-helpers";

describe("business funding-model hub chrome", () => {
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
