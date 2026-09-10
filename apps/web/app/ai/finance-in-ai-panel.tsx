"use client";

import { useCallback, useEffect, useState } from "react";
import { FINANCE_IN_AI_ACK_VERSION } from "@vantage/billing/ai-policy";
import { AiHubRelated } from "../../components/ai-hub-related";
import { hubHref } from "../../lib/nav/hubs";

type PolicySnapshot = {
  financeInAiEnabled: boolean;
  financeInAiAcceptedAt: string | null;
  financeInAiAckVersion: string | null;
};

type FinanceShell = "loading" | "ready" | "empty" | "forbidden" | "auth_required" | "error";

function classifyFinanceShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  policy: PolicySnapshot | null;
}): FinanceShell {
  if (input.loading) return "loading";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/admin|administrator|forbidden|permission|access required/i.test(message)) {
      return "forbidden";
    }
    return "error";
  }
  if (status != null && status >= 500) return "error";
  if (!input.policy?.financeInAiEnabled && !input.policy?.financeInAiAcceptedAt) return "empty";
  return "ready";
}

function financeShellCopy(kind: FinanceShell): { badge?: string; title: string; description: string } {
  switch (kind) {
    case "loading":
      return {
        title: "Loading finance settings…",
        description: "Checking whether this team lets Ask AI see budgets and orders.",
      };
    case "auth_required":
      return {
        badge: "Sign in",
        title: "Sign in to manage finance in Ask AI",
        description: "Each team gives consent separately. Sign in, then reopen Finance from the AI hub.",
      };
    case "forbidden":
      return {
        badge: "Admins only",
        title: "Finance in Ask AI needs an admin",
        description:
          "Owners and admins opt in. Members cannot enable redacted finance tools for the team.",
      };
    case "empty":
      return {
        badge: "Off",
        title: "Finance tools are off",
        description:
          "Assistants will not read season budgets or open orders until an admin enables this and accepts the risk note.",
      };
    case "error":
      return {
        badge: "Unavailable",
        title: "Could not load finance settings",
        description: "Retry, or open Governance if this keeps failing.",
      };
    case "ready":
      return {
        title: "Finance in Ask AI",
        description:
          "When on, assistants may call redacted finance tools. Payment credentials are never stored or sent.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function FinanceInAiPanel({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState<PolicySnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const governanceHref = hubHref("/ai", "governance", orgId);
  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const stripLinks = [
    { id: "chat", label: "Chat", href: chatHref },
    { id: "budgets", label: "Budgets", href: budgetsHref },
    { id: "memory", label: "Memory", href: memoryHref },
    { id: "governance", label: "Governance", href: governanceHref },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setMessage("");
    const response = await fetch(
      `/api/organizations/ai-policy?orgId=${encodeURIComponent(orgId)}`,
    );
    const data = (await response.json()) as { policy?: PolicySnapshot; error?: string };
    setHttpStatus(response.status);
    if (!response.ok) {
      setLoadError(data.error ?? "Could not load finance settings");
      setPolicy(null);
      setLoading(false);
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
    setLoadError(null);
    setLoading(false);
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
    setMessage(response.ok ? "Finance in Ask AI setting saved." : (data.error ?? "Save failed"));
    if (response.ok) void load();
  }

  const shell = classifyFinanceShell({
    loading,
    status: httpStatus,
    error: loadError,
    policy,
  });
  const copy = financeShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";

  return (
    <section className="product-hub-finance" aria-label="Finance in AI">
      <AiHubRelated orgId={orgId} active="finance" />
      <nav className="product-hub-related" aria-label="Related AI tools" style={{ marginBottom: 16 }}>
        {stripLinks.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>

      {loading ? (
        <div className="app-card soft-panel product-hub-setup" aria-busy>
          <h2>{copy.title}</h2>
          <p className="app-muted">{copy.description}</p>
        </div>
      ) : null}

      {blocked ? (
        <div className="app-card soft-panel product-hub-setup" role="status">
          {copy.badge ? <span className="app-badge setup">{copy.badge}</span> : null}
          <h2>{copy.title}</h2>
          <p className="app-muted">{copy.description}</p>
          {shell === "error" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
          {shell === "auth_required" ? (
            <a className="app-button secondary" href="/signin">
              Sign in
            </a>
          ) : null}
          {shell === "forbidden" ? (
            <a className="app-button secondary" href={chatHref}>
              Open Chat
            </a>
          ) : null}
        </div>
      ) : null}

      {!loading && !blocked ? (
        <>
          <div className="app-card soft-panel">
            <h2 style={{ marginTop: 0 }}>Finance in AI</h2>
            <p className="app-muted">
              When enabled, Vantage assistants may call redacted finance tools (season summary, open
              orders, draft purchase requests). Payment credentials are never stored or sent —
              card/bank/SSN patterns are stripped on write and again before any model call.
            </p>
            {shell === "empty" ? (
              <p className="app-muted" role="status">
                <span className="app-badge setup">{copy.badge}</span> {copy.description}
              </p>
            ) : null}
            {policy?.financeInAiAcceptedAt ? (
              <p className="app-muted">
                Last accepted {new Date(policy.financeInAiAcceptedAt).toLocaleString()}
                {policy.financeInAiAckVersion ? ` · ack ${policy.financeInAiAckVersion}` : ""}.
              </p>
            ) : (
              <p className="app-muted">No risk acknowledgement on file yet for this team.</p>
            )}
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
              <small>
                Owners and admins only. Members still need normal finance permissions for writes.
                Redaction stays on whether this toggle is on or off for writes that never reach the
                model.
              </small>
            </span>
          </label>

          {enabled ? (
            <label className="state-control">
              <input
                type="checkbox"
                checked={acked}
                onChange={(event) => setAcked(event.target.checked)}
              />
              <span>
                <strong>I understand redaction limits</strong>
                <small>
                  Redacted budget and order context (amounts, vendor/source, purpose/category) may be
                  sent to the configured model provider. Card numbers, bank accounts, routing, and SSN
                  stay stripped. Ack version {FINANCE_IN_AI_ACK_VERSION}.
                </small>
              </span>
            </label>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="app-button" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save finance toggle"}
            </button>
            <a className="app-button secondary" href={governanceHref}>
              Full governance
            </a>
            <a className="app-button secondary" href={chatHref}>
              Open Chat
            </a>
            <a className="app-button secondary" href={budgetsHref}>
              Open Budgets
            </a>
            <a className="app-button secondary" href={memoryHref}>
              Open Memory
            </a>
          </div>
        </>
      ) : null}

      {message ? (
        <p role="status" className="app-muted">
          {message}
        </p>
      ) : null}
    </section>
  );
}
