import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  syncFundraiserMoney,
  syncFundingSourceMoney,
  syncGrantAwardMoney,
  syncPurchaseLogMoney,
  syncSponsorContributionMoney,
} from "./source-mirrors";

function stubClient() {
  const query = vi.fn(async (_sql: string, _params: unknown[] = []) => ({ rows: [], rowCount: 1 }));
  return { client: { query } as unknown as PoolClient, query };
}

describe("finance source mirrors", () => {
  it("upserts cumulative fundraiser gross once per event", async () => {
    const { client, query } = stubClient();
    await syncFundraiserMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fundraiserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      name: "Robot wash",
      proceedsUsd: 425,
      status: "active",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain("ON CONFLICT");
    expect(query.mock.calls[0]![1]).toEqual(
      expect.arrayContaining(["fundraiser", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 425]),
    );
  });

  it("removes fundraiser money when cancelled", async () => {
    const { client, query } = stubClient();
    await syncFundraiserMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fundraiserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      name: "Robot wash",
      proceedsUsd: 425,
      status: "cancelled",
    });
    expect(query.mock.calls[0]![0]).toContain("DELETE FROM finance_transactions");
  });

  it("keeps linked receipts as non-counting evidence", async () => {
    const { client, query } = stubClient();
    await syncPurchaseLogMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      purchaseLogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      vendor: "Vendor",
      item: "Gearbox",
      amountUsd: 100,
      purchasedOn: "2026-01-02",
      purchaseRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(query.mock.calls[0]![1]?.[13]).toBe(false);
  });

  it("removes a $0 sponsor cash row instead of recording invented progress", async () => {
    const { client, query } = stubClient();
    await syncSponsorContributionMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      contributionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      contributionType: "cash",
      amountUsd: 0,
    });
    expect(query.mock.calls[0]![0]).toContain("DELETE FROM finance_transactions");
    expect(query.mock.calls[0]![0]).not.toContain("ON CONFLICT");
  });

  it("removes an unawarded grant instead of writing a $0 award", async () => {
    const { client, query } = stubClient();
    await syncGrantAwardMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      grantApplicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      name: "NASA",
      status: "submitted",
      amountAwardedUsd: 0,
    });
    expect(query.mock.calls[0]![0]).toContain("DELETE FROM finance_transactions");
  });

  it("records in-kind funding for provenance but not cash balance", async () => {
    const { client, query } = stubClient();
    await syncFundingSourceMoney(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fundingSourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seasonYear: 2026,
      kind: "in_kind",
      name: "Machine shop",
      receivedUsd: 500,
    });
    expect(query.mock.calls[0]![1]?.[13]).toBe(false);
  });
});
