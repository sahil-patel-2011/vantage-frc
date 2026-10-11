"use client";

/**
 * "Who manages money: …" — one line on Team admin and the Money tab.
 *
 * Reads GET /api/finance/managers, which any member may call: the owner always
 * manages money, plus the admins/team members the owner chose (0714). Shows
 * nothing while loading or if the request fails — never a guessed list.
 */

import { useEffect, useState } from "react";

type ManagersPayload = { summary?: string; canChoose?: boolean };

export function MoneyManagersLine({
  orgId,
  version,
  ownerHint = "To change it, open a person’s Access below.",
}: {
  orgId: string;
  /** Change this to re-read the list after a save. */
  version?: string | number;
  /** What an owner is told about where the switch lives. */
  ownerHint?: string;
}) {
  const [data, setData] = useState<ManagersPayload | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/finance/managers?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as ManagersPayload) : null))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, version]);

  if (!data?.summary) return null;
  return (
    <p className="app-muted money-managers-line" role="status">
      {data.summary} {data.canChoose ? ownerHint : "Only the team owner chooses who manages money."}
    </p>
  );
}
