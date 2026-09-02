/**
 * Money-spine mirror helpers for the writers that used to insert straight into
 * finance_transactions (or not at all): sponsor contributions, fundraiser events
 * and the Business-desk receipt log. Each helper is the ONE place that decides
 * the source_kind, idempotency key and label for its writer, and each runs in
 * the caller's withRls transaction so the ledger can never drift from the row it
 * mirrors. All go through recordMoney/removeMoney (0461 upsert key).
 */

import type { PoolClient } from "@neondatabase/serverless";
import { recordMoney, removeMoney } from "./ledger";

/** One ledger row per CASH contribution; in-kind and discounts are not cash and never mirror. */
export async function mirrorSponsorContribution(
  client: PoolClient,
  input: {
    orgId: string;
    contributionId: string;
    sponsorName: string;
    seasonYear: number;
    type: string;
    amountUsd: number | null;
    receivedAt: string | null;
    description: string | null;
    createdBy: string;
  },
): Promise<void> {
  const amount = Number(input.amountUsd ?? 0);
  if (input.type === "cash" && Number.isFinite(amount) && amount > 0) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "sponsor_contribution",
      sourceId: input.contributionId,
      direction: "in",
      amountUsd: amount,
      seasonYear: input.seasonYear,
      label: `Sponsor cash — ${input.sponsorName}${input.description ? ` (${input.description})` : ""}`,
      occurredAt: input.receivedAt,
      createdBy: input.createdBy,
    });
  } else {
    await removeMoney(client, { orgId: input.orgId, source: "sponsor_contribution", sourceId: input.contributionId });
  }
}

/**
 * One income row per fundraiser EVENT carrying its total proceeds, and one expense
 * row carrying its total costs (0504). A cancelled event mirrors nothing — its
 * dollars are excluded everywhere else too.
 */
export async function mirrorFundraiserEvent(
  client: PoolClient,
  input: {
    orgId: string;
    eventId: string;
    name: string;
    seasonYear: number;
    eventDate: string | null;
    status: string;
    proceedsUsd: number;
    expensesUsd: number;
    createdBy: string;
  },
): Promise<void> {
  const active = input.status !== "cancelled";
  if (active && input.proceedsUsd > 0) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "fundraiser",
      sourceId: input.eventId,
      direction: "in",
      amountUsd: input.proceedsUsd,
      seasonYear: input.seasonYear,
      label: `Fundraiser — ${input.name}`,
      occurredAt: input.eventDate,
      createdBy: input.createdBy,
    });
  } else {
    await removeMoney(client, { orgId: input.orgId, source: "fundraiser", sourceId: input.eventId });
  }
  if (active && input.expensesUsd > 0) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "fundraiser_expense",
      sourceId: input.eventId,
      direction: "out",
      amountUsd: input.expensesUsd,
      seasonYear: input.seasonYear,
      label: `Fundraiser cost — ${input.name}`,
      occurredAt: input.eventDate,
      createdBy: input.createdBy,
    });
  } else {
    await removeMoney(client, { orgId: input.orgId, source: "fundraiser_expense", sourceId: input.eventId });
  }
}

export async function removeFundraiserMirrors(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<void> {
  await removeMoney(client, { orgId: input.orgId, source: "fundraiser", sourceId: input.eventId });
  await removeMoney(client, { orgId: input.orgId, source: "fundraiser_expense", sourceId: input.eventId });
}

/**
 * A Business-desk receipt is money out UNLESS it is attached to a purchase request,
 * whose own mirror row already holds those dollars (the 0461 backfill rule).
 */
export async function mirrorPurchaseLog(
  client: PoolClient,
  input: {
    orgId: string;
    purchaseId: string;
    seasonYear: number;
    vendor: string;
    item: string;
    categoryId: string | null;
    amountUsd: number;
    purchasedOn: string;
    purchaseRequestId: string | null;
    grantApplicationId: string | null;
    createdBy: string;
  },
): Promise<void> {
  if (input.purchaseRequestId || !(input.amountUsd > 0)) {
    await removeMoney(client, { orgId: input.orgId, source: "purchase_log", sourceId: input.purchaseId });
    return;
  }
  await recordMoney(client, {
    orgId: input.orgId,
    source: "purchase_log",
    sourceId: input.purchaseId,
    direction: "out",
    amountUsd: input.amountUsd,
    seasonYear: input.seasonYear,
    categoryId: input.categoryId,
    label: `${input.vendor} — ${input.item}`,
    occurredAt: input.purchasedOn,
    createdBy: input.createdBy,
    grantApplicationId: input.grantApplicationId,
  });
}
