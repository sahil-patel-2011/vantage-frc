"use client";

import { useEffect, useState } from "react";
import { FreebuffPiSetupPanel } from "./freebuff-pi-setup-panel";

/**
 * Tells a team what is currently paying for its AI, and — when the platform
 * opened a FreeBuff window — lets them pick whether that window is the team's
 * main AI and which Freebuff model to send (DeepSeek V4 Flash is the default).
 *
 * Isolation is not a Pi setting: every request is tagged with this org only.
 * Turning the toggle on does not let this team see another team's memory.
 */
type FreebuffModel = { id: string; slug: string; label: string; metered?: boolean; note?: string };

type TokenBalance = {
  source: "freebuff" | "hosted_platform" | "credits" | string;
  granted: number;
  spent: number;
  balance: number;
};

type Funding = {
  credits: { onPlan: boolean; granted: number; spent: number; balance: number };
  tokens?: TokenBalance[];
  grants: Array<{ accessKind: string; endsAt: string; note: string }>;
  weights: Array<{ requestKind: string; credits: number }>;
  canManage?: boolean;
  usePlatformFreeAi?: boolean;
  freebuffModel?: string;
  freebuffModels?: FreebuffModel[];
};

const ACCESS_LABELS: Record<string, string> = {
  platform_relay: "platform Free AI (FreeBuff)",
  hosted_platform: "platform-hosted keys",
  sponsored_pool: "the sponsored provider pool",
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function AiFundingPanel({ orgId }: { orgId: string | null }) {
  const [funding, setFunding] = useState<Funding | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/team/ai-funding?orgId=${encodeURIComponent(orgId)}`);
        if (!response.ok) return;
        const data = (await response.json()) as Funding;
        if (!cancelled) setFunding(data);
      } catch {
        // Silent: this panel is supplementary to key setup.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!funding) return null;
  const { credits, grants, weights } = funding;
  const tokens = funding.tokens ?? [];
  const freebuffTokens = tokens.find((row) => row.source === "freebuff" && row.granted > 0);
  const hostedTokens = tokens.find((row) => row.source === "hosted_platform" && row.granted > 0);
  const giftedTokens = freebuffTokens ?? hostedTokens;
  const relayGrant = grants.find((grant) => grant.accessKind === "platform_relay");
  if (!credits.onPlan && grants.length === 0 && !giftedTokens) return null;

  const chat = weights.find((weight) => weight.requestKind === "chat")?.credits ?? 1;
  const agentic = weights.find((weight) => weight.requestKind === "agentic")?.credits ?? 4;
  const models = funding.freebuffModels ?? [];
  const useFree = funding.usePlatformFreeAi !== false;

  async function savePlatformFree(next: { usePlatformFreeAi: boolean; freebuffModel: string }) {
    if (!orgId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/team/ai-funding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...next }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save Free AI settings");
        return;
      }
      setFunding((current) =>
        current
          ? { ...current, usePlatformFreeAi: next.usePlatformFreeAi, freebuffModel: next.freebuffModel }
          : current,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="app-card soft-panel ai-funding-panel" aria-labelledby="ai-funding-title">
      <h2 id="ai-funding-title">How your AI is funded</h2>

      {grants.map((grant) => {
        const days = daysUntil(grant.endsAt);
        return (
          <p key={grant.endsAt} className="ai-funding-grant" role="note">
            <strong>Your AI is running on {ACCESS_LABELS[grant.accessKind] ?? grant.accessKind}.</strong>{" "}
            This was lent to your team by the platform and ends{" "}
            {new Date(grant.endsAt).toLocaleDateString()}
            {days > 0 ? ` (${days} day${days === 1 ? "" : "s"} left)` : ""}.
            {grant.accessKind === "platform_relay"
              ? " Chat, Bugbot, and background jobs stay inside this team — the shared box never sees another team's memory."
              : " Add your own key below any time — your keys take priority when Free AI is turned off."}
            {grant.note ? ` ${grant.note}` : ""}
          </p>
        );
      })}

      {relayGrant && models.length > 0 ? (
        <div className="ai-funding-free">
          <label className="ai-funding-toggle">
            <input
              type="checkbox"
              checked={useFree}
              disabled={!funding.canManage || saving}
              onChange={(event) =>
                void savePlatformFree({
                  usePlatformFreeAi: event.target.checked,
                  freebuffModel: funding.freebuffModel ?? models[0]!.slug,
                })
              }
            />
            Use platform Free AI for this team
          </label>
          <p className="app-muted">
            When this is on, every chat, Bugbot, and async job for this team goes to FreeBuff
            before your own keys. DeepSeek V4 Flash is free, unlimited, and the fast default.
            Context is never shared with another team.
          </p>
          <label className="ai-funding-model">
            Free AI model
            <select
              value={funding.freebuffModel ?? models[0]!.slug}
              disabled={!funding.canManage || saving || !useFree}
              onChange={(event) =>
                void savePlatformFree({
                  usePlatformFreeAi: useFree,
                  freebuffModel: event.target.value,
                })
              }
            >
              {models.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.metered
                    ? `${option.label} (metered)`
                    : option.note
                      ? `${option.label} — ${option.note}`
                      : option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {message ? <p className="ai-funding-grant">{message}</p> : null}

      {giftedTokens ? (
        <>
          <p className="ai-funding-grant" role="status">
            <strong>You have {giftedTokens.balance.toLocaleString()} free tokens.</strong>
          </p>
          <div className="ai-funding-metrics">
            <div>
              <strong>{giftedTokens.balance.toLocaleString()}</strong>
              <span>free tokens left</span>
            </div>
            <div>
              <strong>{giftedTokens.spent.toLocaleString()}</strong>
              <span>used</span>
            </div>
            <div>
              <strong>{giftedTokens.granted.toLocaleString()}</strong>
              <span>gifted</span>
            </div>
          </div>
          <p className="app-muted">
            Short answers, generation, and long runs all spend these free tokens for this
            team only. Your own API key never spends them.
          </p>
        </>
      ) : credits.onPlan ? (
        <>
          <div className="ai-funding-metrics">
            <div>
              <strong>{credits.balance.toLocaleString()}</strong>
              <span>requests left</span>
            </div>
            <div>
              <strong>{credits.spent.toLocaleString()}</strong>
              <span>used</span>
            </div>
            <div>
              <strong>{credits.granted.toLocaleString()}</strong>
              <span>granted</span>
            </div>
          </div>
          <p className="app-muted">
            A chat message costs {chat} credit{chat === 1 ? "" : "s"}; an agent run costs{" "}
            {agentic}, because it makes many model calls for one action. Requests on your own
            key never spend credits.
          </p>
        </>
      ) : relayGrant ? (
        <p className="app-muted">
          This team is on unlimited Free AI for the window above. Request credits are not
          counting down.
        </p>
      ) : null}

      <FreebuffPiSetupPanel granted={Boolean(relayGrant)} />
    </section>
  );
}
