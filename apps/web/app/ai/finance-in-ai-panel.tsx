"use client";

import { useCallback, useEffect, useState } from "react";
import { FINANCE_IN_AI_ACK_VERSION } from "@vantage/billing";

type PolicySnapshot = {
  financeInAiEnabled: boolean;
  financeInAiAcceptedAt: string | null;
  financeInAiAckVersion: string | null;
};

export function FinanceInAiPanel({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState<PolicySnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    const response = await fetch(`/api/organizations/ai-policy?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as { policy?: PolicySnapshot; error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Could not load finance-in-AI policy");
      return;
    }
    const next = data.policy ?? {
      financeInAiEnabled: false,
      financeInAiAcceptedAt: null,
      financeInAiAckVersion: null,
    };
    setPolicy(next);
    setEnabled(Boolean(next.financeInAiEnabled));
    setAcked(
      Boolean(next.financeInAiAcceptedAt) && next.financeInAiAckVersion === FINANCE_IN_AI_ACK_VERSION,
    );
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (enabled && !acked) {
      setMessage("Acknowledge the risk note before enabling finance in AI.");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/organizations/ai-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        financeInAiOnly: true,
        financeInAiEnabled: enabled,
        financeInAiAckAccepted: enabled ? acked : false,
      }),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setMessage(response.ok ? "Finance-in-AI setting saved." : (data.error ?? "Save failed"));
    if (response.ok) void load();
  }

  return (
    <section className="product-hub-finance" aria-label="Finance in AI">
      <div className="app-card soft-panel">
        <h2 style={{ marginTop: 0 }}>Finance in AI</h2>
        <p className="app-muted">
          When enabled, Vantage assistants may call redacted finance tools (season summary, open orders,
          draft purchase requests). Payment credentials are never stored or sent — card/bank patterns are
          stripped on write and again before any model call.
        </p>
        {policy?.financeInAiAcceptedAt ? (
          <p className="app-muted">
            Last accepted {new Date(policy.financeInAiAcceptedAt).toLocaleString()}
            {policy.financeInAiAckVersion ? ` · ack ${policy.financeInAiAckVersion}` : ""}.
          </p>
        ) : null}
      </div>
      <label className="state-control">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            if (!event.target.checked) setAcked(false);
          }}
        />
        <span>
          <strong>Allow finance tools in AI</strong>
          <small>Owners and admins only. Members still need normal finance permissions for writes.</small>
        </span>
      </label>
      {enabled ? (
        <label className="state-control">
          <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} />
          <span>
            <strong>I understand the risk</strong>
            <small>
              Redacted budget and order context may be sent to the configured model provider. Ack version{" "}
              {FINANCE_IN_AI_ACK_VERSION}.
            </small>
          </span>
        </label>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="app-button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save finance toggle"}
        </button>
        <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=orders`}>
          Open orders
        </a>
        <a className="app-button secondary" href={`/ai?orgId=${encodeURIComponent(orgId)}&tab=governance`}>
          Full governance
        </a>
      </div>
      {message ? <p role="status" className="app-muted">{message}</p> : null}
    </section>
  );
}