import { describe, expect, it } from "vitest";
import {
  buildLinkSpendPayload,
  grantApplicationOptions,
  namedExpensesFromLedger,
} from "./allocate-spend";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANT = "22222222-2222-4222-8222-222222222222";
const TXN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

describe("namedExpensesFromLedger", () => {
  it("keeps named outbound expenses with amount > 0", () => {
    const named = namedExpensesFromLedger([
      { id: TXN, label: "Robot parts", amountUsd: 150.4, direction: "out", mirrored: true },
      { id: OTHER, label: "Travel", amountUsd: "75.555", direction: "out" },
    ]);
    expect(named).toEqual([
      { id: TXN, label: "Robot parts", amountUsd: 150.4 },
      { id: OTHER, label: "Travel", amountUsd: 75.56 },
    ]);
  });

  it("drops income, unmirrored fallbacks, zero/invalid amounts, and never sums a season total", () => {
    const named = namedExpensesFromLedger([
      { id: TXN, label: "Sponsor cash", amountUsd: 5000, direction: "in", mirrored: true },
      { id: OTHER, label: "Legacy receipt", amountUsd: 40, direction: "out", mirrored: false },
      { id: "not-a-uuid", label: "Bad id", amountUsd: 10, direction: "out", mirrored: true },
      { id: TXN, label: "Zero", amountUsd: 0, direction: "out", mirrored: true },
    ]);
    expect(named).toEqual([]);
    expect(namedExpensesFromLedger({ seasonTotalUsd: 12800, ledger: named })).toEqual([]);
  });
});

describe("grantApplicationOptions", () => {
  it("labels applications from recorded names and skips invalid ids", () => {
    expect(
      grantApplicationOptions([
        { id: GRANT, opportunityName: "STEM Innovation", status: "awarded" },
        { id: "nope", opportunityName: "Ghost" },
        { id: OTHER, summary: "Travel ask" },
      ]),
    ).toEqual([
      { id: GRANT, label: "STEM Innovation · awarded" },
      { id: OTHER, label: "Travel ask" },
    ]);
  });
});

describe("buildLinkSpendPayload", () => {
  it("posts the typed amount and ignores season totals", () => {
    const parsed = buildLinkSpendPayload({
      orgId: ORG,
      grantApplicationId: GRANT,
      financeTransactionId: TXN,
      amountUsd: 150,
      seasonTotalUsd: 5000,
      copySeason: true,
      seasonExpensesUsd: 12800,
    });
    expect(parsed).toEqual({
      ok: true,
      body: {
        orgId: ORG,
        grantApplicationId: GRANT,
        financeTransactionId: TXN,
        amountUsd: 150,
      },
    });
  });

  it("refuses a missing or non-positive amount instead of inventing a season total", () => {
    expect(
      buildLinkSpendPayload({
        orgId: ORG,
        grantApplicationId: GRANT,
        financeTransactionId: TXN,
        amountUsd: "",
        seasonTotalUsd: 5000,
      }).ok,
    ).toBe(false);
    expect(
      buildLinkSpendPayload({
        orgId: ORG,
        grantApplicationId: GRANT,
        financeTransactionId: TXN,
        amountUsd: 0,
      }).ok,
    ).toBe(false);
    expect(
      buildLinkSpendPayload({
        orgId: ORG,
        grantApplicationId: GRANT,
        financeTransactionId: TXN,
        amountUsd: "DEMO",
      }).ok,
    ).toBe(false);
  });
});
