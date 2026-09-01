import type { PoolClient } from "@neondatabase/serverless";
import { isRealCashAmount } from "./honesty";
import { recordMoney, removeMoney } from "./ledger";

type SponsorContributionMirror = {
  orgId: string;
  contributionId: string;
  seasonYear: number;
  contributionType: string;
  amountUsd: number | null;
  receivedAt?: string | Date | null;
  label?: string | null;
  userId?: string | null;
};

export async function syncSponsorContributionMoney(
  client: PoolClient,
  input: SponsorContributionMirror,
): Promise<void> {
  if (input.contributionType === "cash" && isRealCashAmount(input.amountUsd)) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "sponsor_contribution",
      sourceId: input.contributionId,
      direction: "in",
      amountUsd: Number(input.amountUsd),
      seasonYear: input.seasonYear,
      occurredAt: input.receivedAt,
      label: input.label ?? "Sponsor contribution",
      createdBy: input.userId,
    });
    return;
  }
  await removeMoney(client, {
    orgId: input.orgId,
    source: "sponsor_contribution",
    sourceId: input.contributionId,
  });
}

export async function syncFundraiserMoney(
  client: PoolClient,
  input: {
    orgId: string;
    fundraiserId: string;
    seasonYear: number;
    name: string;
    proceedsUsd: number;
    eventDate?: string | Date | null;
    status: string;
    userId?: string | null;
  },
): Promise<void> {
  if (input.status !== "cancelled" && isRealCashAmount(input.proceedsUsd)) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "fundraiser",
      sourceId: input.fundraiserId,
      direction: "in",
      amountUsd: input.proceedsUsd,
      seasonYear: input.seasonYear,
      occurredAt: input.eventDate,
      label: `Fundraiser — ${input.name}`,
      createdBy: input.userId,
    });
    return;
  }
  await removeMoney(client, {
    orgId: input.orgId,
    source: "fundraiser",
    sourceId: input.fundraiserId,
  });
}

/**
 * finance_funding_sources and grant_applications predate the source-kind
 * discriminator and have no dedicated CHECK value. They use the existing
 * `other` mirror slot until the schema adds first-class source kinds.
 */
export async function syncFundingSourceMoney(
  client: PoolClient,
  input: {
    orgId: string;
    fundingSourceId: string;
    seasonYear: number;
    kind: string;
    name: string;
    receivedUsd: number;
    receivedOn?: string | Date | null;
    userId?: string | null;
  },
): Promise<void> {
  if (isRealCashAmount(input.receivedUsd)) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "other",
      sourceId: input.fundingSourceId,
      direction: "in",
      amountUsd: input.receivedUsd,
      seasonYear: input.seasonYear,
      occurredAt: input.receivedOn,
      label: `Funding — ${input.name}`,
      createdBy: input.userId,
      countsInBalance: input.kind !== "in_kind",
    });
    return;
  }
  await removeMoney(client, {
    orgId: input.orgId,
    source: "other",
    sourceId: input.fundingSourceId,
  });
}

export async function syncGrantAwardMoney(
  client: PoolClient,
  input: {
    orgId: string;
    grantApplicationId: string;
    seasonYear: number;
    name: string;
    status: string;
    amountAwardedUsd: number;
    decisionAt?: string | Date | null;
    userId?: string | null;
  },
): Promise<void> {
  if (input.status === "awarded" && isRealCashAmount(input.amountAwardedUsd)) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "other",
      sourceId: input.grantApplicationId,
      direction: "in",
      amountUsd: input.amountAwardedUsd,
      seasonYear: input.seasonYear,
      occurredAt: input.decisionAt,
      label: `Grant awarded — ${input.name}`,
      createdBy: input.userId,
    });
    return;
  }
  await removeMoney(client, {
    orgId: input.orgId,
    source: "other",
    sourceId: input.grantApplicationId,
  });
}

export async function syncPurchaseLogMoney(
  client: PoolClient,
  input: {
    orgId: string;
    purchaseLogId: string;
    seasonYear: number;
    vendor: string;
    item: string;
    amountUsd: number;
    purchasedOn: string | Date;
    categoryId?: string | null;
    purchaseRequestId?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  if (isRealCashAmount(input.amountUsd)) {
    await recordMoney(client, {
      orgId: input.orgId,
      source: "purchase_log",
      sourceId: input.purchaseLogId,
      direction: "out",
      amountUsd: input.amountUsd,
      seasonYear: input.seasonYear,
      categoryId: input.categoryId,
      occurredAt: input.purchasedOn,
      label: `${input.vendor} — ${input.item}`,
      createdBy: input.userId,
      // A receipt tied to an order documents the same spend; retain it on the
      // spine for provenance without counting the dollars twice.
      countsInBalance: !input.purchaseRequestId,
    });
    return;
  }
  await removeMoney(client, {
    orgId: input.orgId,
    source: "purchase_log",
    sourceId: input.purchaseLogId,
  });
}
