"use client";

import { useEffect, useState } from "react";

type PolicyForm = {
  featureAllowlistEnabled: boolean;
  allowedFeatures: string[];
  toolAllowlistEnabled: boolean;
  allowedTools: string[];
  highCostThresholdUsd: string;
  requireApprovalAboveThreshold: boolean;
  requireApprovalForFeatures: string[];
  adminBypassApproval: boolean;
  dailySpendAlertUsd: string;
  monthlySpendAlertUsd: string;
  spendAlertThresholds: string;
};

type Approval = {
  id: string;
  runId: string | null;
  feature: string;
  provider: string | null;
  model: string | null;
  estimatedCostUsd: string;
  reason: string | null;
  createdAt: string;
  requesterName: string | null;
  requesterEmail: string | null;
};

type ModelLimit = { provider: string; model: string; allowed: boolean };

const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
const num = (value: unknown) => Number(value ?? 0).toLocaleString();
const toggleList = (list: string[], value: string) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

const defaultForm: PolicyForm = {
  featureAllowlistEnabled: false,
  allowedFeatures: [],
  toolAllowlistEnabled: false,
  allowedTools: [],
  highCostThresholdUsd: "",
  requireApprovalAboveThreshold: false,
  requireApprovalForFeatures: [],
  adminBypassApproval: true,
  dailySpendAlertUsd: "",
  monthlySpendAlertUsd: "",
  spendAlertThresholds: "50,75,90",
};

export default function AiPolicyClient({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<PolicyForm>(defaultForm);
  const [features, setFeatures] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [models, setModels] = useState<ModelLimit[]>([]);
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState<{
    modelAllowlistEnabled?: boolean;
    providerAllowlistEnabled?: boolean;
    killSwitch?: boolean;
  } | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [policyRes, approvalRes] = await Promise.all([
      fetch(`/api/organizations/ai-policy?orgId=${orgId}`),
      fetch(`/api/organizations/ai-approvals?orgId=${orgId}&status=pending`),
    ]);
    const policyData = await policyRes.json();
    const approvalData = await approvalRes.json();
    if (!policyRes.ok) {
      setMessage(policyData.error ?? "Unable to load AI policy");
      setLoading(false);
      return;
    }
    if (policyData.policy) {
      const policy = policyData.policy;
      setForm({
        featureAllowlistEnabled: Boolean(policy.featureAllowlistEnabled),
        allowedFeatures: policy.allowedFeatures ?? [],
        toolAllowlistEnabled: Boolean(policy.toolAllowlistEnabled),
        allowedTools: policy.allowedTools ?? [],
        highCostThresholdUsd:
          policy.highCostThresholdUsd == null ? "" : String(policy.highCostThresholdUsd),
        requireApprovalAboveThreshold: Boolean(policy.requireApprovalAboveThreshold),
        requireApprovalForFeatures: policy.requireApprovalForFeatures ?? [],
        adminBypassApproval: policy.adminBypassApproval !== false,
        dailySpendAlertUsd:
          policy.dailySpendAlertUsd == null ? "" : String(policy.dailySpendAlertUsd),
        monthlySpendAlertUsd:
          policy.monthlySpendAlertUsd == null ? "" : String(policy.monthlySpendAlertUsd),
        spendAlertThresholds: (policy.spendAlertThresholds ?? [50, 75, 90]).join(","),
      });
    }
    setFeatures(policyData.catalog?.features ?? []);
    setTools(policyData.catalog?.tools ?? []);
    setModels(policyData.models ?? []);
    setUsage(policyData.usage ?? {});
    setBudget(policyData.budget ?? null);
    setPendingCount(Number(policyData.pendingApprovals ?? 0));
    setApprovals(approvalData.approvals ?? []);
    setMessage(approvalRes.ok ? "" : (approvalData.error ?? ""));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/organizations/ai-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        ...form,
        highCostThresholdUsd: form.highCostThresholdUsd || null,
        dailySpendAlertUsd: form.dailySpendAlertUsd || null,
        monthlySpendAlertUsd: form.monthlySpendAlertUsd || null,
        spendAlertThresholds: form.spendAlertThresholds
          .split(",")
          .map((value) => Number(value.trim())),
      }),
    });
    const data = await response.json();
    setMessage(response.ok ? "AI governance policy saved and audited." : data.error);
    setSaving(false);
    if (response.ok) await load();
  }

  async function decide(approvalId: string, decision: "approve" | "deny") {
    const response = await fetch("/api/organizations/ai-approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, approvalId, decision }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? decision === "approve"
          ? "Run approved — requester can retry within 24h (consumed once)."
          : "Run denied."
        : data.error,
    );
    if (response.ok) await load();
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI GOVERNANCE</span>
          <h1>Org policy for models, tools, and spend</h1>
          <p className="app-muted">
            Control which assistant features and tools members may use, set absolute spend alerts, and
            require admin approval before high-cost runs. Model/provider allowlists live under API
            budgets; this page owns tool/feature policy and the approval queue.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Governance links">
          <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a>
          <a href={`/team/usage?orgId=${orgId}`}>AI usage</a>
          <a href={`/team/ai-runs?orgId=${orgId}`}>AI runs</a>
          <a href={`/team/ai-memory?orgId=${orgId}`}>AI memory</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading AI governance…</p>}

      {!loading && (
        <>
          <section className="metric-grid">
            <article>
              <span>Spend today</span>
              <strong>{money(usage.dailySpend)}</strong>
            </article>
            <article>
              <span>Spend this month</span>
              <strong>{money(usage.monthlySpend)}</strong>
            </article>
            <article>
              <span>Pending approvals</span>
              <strong>{num(pendingCount)}</strong>
            </article>
            <article>
              <span>Model allowlist</span>
              <strong>{budget?.modelAllowlistEnabled ? "On" : "Off"}</strong>
            </article>
          </section>

          <form className="intel-panel auth-policy-form" onSubmit={save} style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">FEATURE &amp; TOOL POLICY</span>
            <label className="state-control">
              <input
                type="checkbox"
                checked={form.featureAllowlistEnabled}
                onChange={(e) => setForm({ ...form, featureAllowlistEnabled: e.target.checked })}
              />
              <span>
                <strong>Enforce feature allowlist</strong>
                <small>When on, only checked capabilities may call metered AI.</small>
              </span>
            </label>
            <div className="budget-fields" style={{ display: "grid", gap: "0.35rem" }}>
              {features.map((feature) => (
                <label key={feature} className="check-field">
                  <input
                    type="checkbox"
                    checked={form.allowedFeatures.includes(feature)}
                    onChange={() =>
                      setForm({ ...form, allowedFeatures: toggleList(form.allowedFeatures, feature) })
                    }
                  />
                  {feature}
                </label>
              ))}
            </div>

            <label className="state-control" style={{ marginTop: "1rem" }}>
              <input
                type="checkbox"
                checked={form.toolAllowlistEnabled}
                onChange={(e) => setForm({ ...form, toolAllowlistEnabled: e.target.checked })}
              />
              <span>
                <strong>Enforce tool allowlist</strong>
                <small>Blocks unauthorized assistant tools before they run.</small>
              </span>
            </label>
            <div className="budget-fields" style={{ display: "grid", gap: "0.35rem" }}>
              {tools.map((tool) => (
                <label key={tool} className="check-field">
                  <input
                    type="checkbox"
                    checked={form.allowedTools.includes(tool)}
                    onChange={() =>
                      setForm({ ...form, allowedTools: toggleList(form.allowedTools, tool) })
                    }
                  />
                  {tool}
                </label>
              ))}
            </div>

            <span className="eyebrow" style={{ marginTop: "1.25rem", display: "block" }}>
              HIGH-COST APPROVAL
            </span>
            <label className="state-control">
              <input
                type="checkbox"
                checked={form.requireApprovalAboveThreshold}
                onChange={(e) =>
                  setForm({ ...form, requireApprovalAboveThreshold: e.target.checked })
                }
              />
              <span>
                <strong>Require approval above estimated cost</strong>
                <small>Uses the caller&apos;s estimatedCostUsd (CAD/research can pass real estimates).</small>
              </span>
            </label>
            <label>
              High-cost threshold (USD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.highCostThresholdUsd}
                onChange={(e) => setForm({ ...form, highCostThresholdUsd: e.target.value })}
              />
            </label>
            <p className="field-help">Also require approval for these features regardless of estimate:</p>
            <div className="budget-fields" style={{ display: "grid", gap: "0.35rem" }}>
              {features.map((feature) => (
                <label key={`approve-${feature}`} className="check-field">
                  <input
                    type="checkbox"
                    checked={form.requireApprovalForFeatures.includes(feature)}
                    onChange={() =>
                      setForm({
                        ...form,
                        requireApprovalForFeatures: toggleList(
                          form.requireApprovalForFeatures,
                          feature,
                        ),
                      })
                    }
                  />
                  {feature}
                </label>
              ))}
            </div>
            <label className="state-control">
              <input
                type="checkbox"
                checked={form.adminBypassApproval}
                onChange={(e) => setForm({ ...form, adminBypassApproval: e.target.checked })}
              />
              <span>
                <strong>Owners/admins bypass approval</strong>
                <small>Recommended so admins can still operate while the queue is on.</small>
              </span>
            </label>

            <span className="eyebrow" style={{ marginTop: "1.25rem", display: "block" }}>
              SPEND ALERTS
            </span>
            <label>
              Warning thresholds (%)
              <input
                value={form.spendAlertThresholds}
                onChange={(e) => setForm({ ...form, spendAlertThresholds: e.target.value })}
              />
              <small>Synced to API budget percentage warnings (e.g. 50,75,90).</small>
            </label>
            <div className="budget-fields">
              <label>
                Daily absolute alert (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dailySpendAlertUsd}
                  onChange={(e) => setForm({ ...form, dailySpendAlertUsd: e.target.value })}
                />
              </label>
              <label>
                Monthly absolute alert (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlySpendAlertUsd}
                  onChange={(e) => setForm({ ...form, monthlySpendAlertUsd: e.target.value })}
                />
              </label>
            </div>

            <button className="primary-action" disabled={saving}>
              {saving ? "Saving…" : "Save AI governance policy"}
            </button>
          </form>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">MODEL ALLOWLIST (FROM API BUDGETS)</span>
            <p className="app-muted">
              {budget?.modelAllowlistEnabled || budget?.providerAllowlistEnabled
                ? "Model/provider allowlist enforcement is on."
                : "Model/provider allowlist enforcement is off."}{" "}
              Edit on <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a>
              {budget?.killSwitch ? " · Kill switch is active." : "."}
            </p>
            {models.length === 0 ? (
              <p className="app-muted">No per-model rules yet.</p>
            ) : (
              <ul>
                {models.map((model) => (
                  <li key={`${model.provider}/${model.model}`}>
                    {model.provider}/{model.model} · {model.allowed ? "allowed" : "blocked"}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">PENDING HIGH-COST APPROVALS</span>
            {approvals.length === 0 ? (
              <p className="app-muted">No pending approvals.</p>
            ) : (
              approvals.map((approval) => (
                <article
                  key={approval.id}
                  style={{
                    display: "grid",
                    gap: "0.35rem",
                    marginTop: "0.75rem",
                    paddingTop: "0.75rem",
                    borderTop: "1px solid color-mix(in oklab, currentColor 12%, transparent)",
                  }}
                >
                  <strong>
                    {approval.feature}
                    {approval.provider ? ` · ${approval.provider}/${approval.model}` : ""}
                  </strong>
                  <small>
                    {approval.requesterName ?? "Member"}
                    {approval.requesterEmail ? ` · ${approval.requesterEmail}` : ""} · est.{" "}
                    {money(approval.estimatedCostUsd)} · {approval.reason ?? "approval"}
                  </small>
                  <small>{new Date(approval.createdAt).toLocaleString()}</small>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => void decide(approval.id, "approve")}
                    >
                      Approve
                    </button>
                    <button type="button" onClick={() => void decide(approval.id, "deny")}>
                      Deny
                    </button>
                    {approval.runId && <a href={`/team/ai-runs?orgId=${orgId}`}>View runs</a>}
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
