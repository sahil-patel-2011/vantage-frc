"use client";

import { useEffect, useState } from "react";
import { buildUsageCutoffSnapshot, type UsageCutoffSnapshot } from "../lib/billing/usage-cutoff";
import { UsageCutoffBanner } from "./usage-cutoff-banner";

type CutoffPayload = {
  planCode?: string | null;
  includedAllowanceUsd?: number;
  usedUsd?: number;
  walletBalanceUsd?: number;
  paygEnabled?: boolean;
  spendCapUsd?: number | null;
  killSwitch?: boolean;
  monthlySpendUsd?: number;
  monthlySpendLimitUsd?: number | null;
  warningThresholds?: number[];
};

/**
 * Soft-UI cutoff banner for metered AI surfaces: proactive near/at limits from
 * budgets, plus hard-cutoff error codes from a failed AI call.
 */
export function MeteredAiCutoffBanner({
  orgId,
  errorCode,
  compact,
  className,
}: {
  orgId: string;
  errorCode?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<UsageCutoffSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/billing/budgets?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { cutoff?: CutoffPayload | null };
        if (cancelled || !data.cutoff) return;
        const cutoff = data.cutoff;
        setSnapshot(
          buildUsageCutoffSnapshot({
            planCode: cutoff.planCode,
            includedAllowanceUsd: cutoff.includedAllowanceUsd,
            usedUsd: cutoff.usedUsd,
            walletBalanceUsd: cutoff.walletBalanceUsd,
            paygEnabled: cutoff.paygEnabled,
            spendCapUsd: cutoff.spendCapUsd,
            killSwitch: cutoff.killSwitch,
            monthlySpendUsd: cutoff.monthlySpendUsd,
            monthlySpendLimitUsd: cutoff.monthlySpendLimitUsd,
            warningThresholds: cutoff.warningThresholds ?? [50, 75, 90],
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (errorCode) {
    return (
      <UsageCutoffBanner orgId={orgId} errorCode={errorCode} compact={compact} className={className} />
    );
  }
  if (!snapshot) return null;
  return (
    <UsageCutoffBanner orgId={orgId} snapshot={snapshot} compact={compact} className={className} />
  );
}
