"use client";

import { useEffect, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import {
  AI_GOVERNANCE_RELATED_INCLUDE,
  AI_GOVERNANCE_SCOPE_CARDS,
  aiGovernanceNextActions,
  aiGovernanceRelatedLinks,
  aiGovernanceShellCopy,
  classifyAiGovernanceShell,
  formatAiGovernanceCount,
  formatAiGovernanceMoney,
  type AiGovernancePolicySnapshot,
  type AiGovernanceShellKind,
} from "../../../lib/ai-governance/ai-governance-related";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import "./ai-policy.css";

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
  financeInAiEnabled: boolean;
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
  financeInAiEnabled: false,
};

function toSnapshot(form: PolicyForm, pendingApprovals: number): AiGovernancePolicySnapshot {
  return {
    featureAllowlistEnabled: form.featureAllowlistEnabled,
    allowedFeaturesCount: form.allowedFeatures.length,
    toolAllowlistEnabled: form.toolAllowlistEnabled,
    allowedToolsCount: form.allowedTools.length,
    requireApprovalAboveThreshold: form.requireApprovalAboveThreshold,
    highCostThresholdSet: form.highCostThresholdUsd.trim() !== "",
    requireApprovalForFeaturesCount: form.requireApprovalForFeatures.length,
    financeInAiEnabled: form.financeInAiEnabled,
    dailySpendAlertSet: form.dailySpendAlertUsd.trim() !== "",
    monthlySpendAlertSet: form.monthlySpendAlertUsd.trim() !== "",
    pendingApprovals,
  };
}

function GovernanceRelatedStrip({ orgId }: { orgId: string }) {
  const links = aiGovernanceRelatedLinks(orgId, { include: [...AI_GOVERNANCE_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-governance-related" aria-label="Related AI tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActions({ orgId, shell }: { orgId: string; shell: AiGovernanceShellKind }) {
  const actions = aiGovernanceNextActions({ orgId, shell });
  if (!actions.length) return null;
  return (
    <section
      className="ai-governance-next-actions app-card soft-panel edc-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p>From real org policy and Neon spend only — never DEMO policy stats.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [financeInAiAcceptedAt, setFinanceInAiAcceptedAt] = useState<string | null>(null);
  const [financeInAiAckVersion, setFinanceInAiAckVersion] = useState<string | null>(null);
  const [catalogFinanceAckVersion, setCatalogFinanceAckVersion] = useState<string | null>(null);
  const [financeInAiRiskAccepted, setFinanceInAiRiskAccepted] = useState(false);
  const [financeRiskModalOpen, setFinanceRiskModalOpen] = useState(false);

  const financeAckCurrent =
    Boolean(financeInAiAcceptedAt) &&
    Boolean(catalogFinanceAckVersion) &&
    financeInAiAckVersion === catalogFinanceAckVersion;

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const financeHref = hubHref("/ai", "finance", orgId);
  const runsHref = withOrgHref("/team/ai-runs", orgId);
  const headerLinks = aiGovernanceRelatedLinks(orgId);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const [policyRes, approvalRes] = await Promise.all([
      fetch(`/api/organizations/ai-policy?orgId=${encodeURIComponent(orgId)}`),
      fetch(
        `/api/organizations/ai-approvals?orgId=${encodeURIComponent(orgId)}&status=pending`,
      ),
    ]);
    const policyData = (await policyRes.json()) as {
      error?: string;
      policy?: Record<string, unknown> | null;
      catalog?: { features?: string[]; tools?: string[]; financeInAiAckVersion?: string };
      models?: ModelLimit[];
      usage?: Record<string, string>;
      budget?: {
        modelAllowlistEnabled?: boolean;
        providerAllowlistEnabled?: boolean;
        killSwitch?: boolean;
      } | null;
      pendingApprovals?: number;
    };
    const approvalData = (await approvalRes.json()) as {
      error?: string;
      approvals?: Approval[];
    };
    setHttpStatus(policyRes.status);
    if (!policyRes.ok) {
      setLoadError(policyData.error ?? "Unable to load AI policy");
      setMessage("");
      setLoading(false);
      return;
    }
    setLoadError(null);
    if (policyData.policy) {
      const policy = policyData.policy;
      setForm({
        featureAllowlistEnabled: Boolean(policy.featureAllowlistEnabled),
        allowedFeatures: (policy.allowedFeatures as string[]) ?? [],
        toolAllowlistEnabled: Boolean(policy.toolAllowlistEnabled),
        allowedTools: (policy.allowedTools as string[]) ?? [],
        highCostThresholdUsd:
          policy.highCostThresholdUsd == null ? "" : String(policy.highCostThresholdUsd),
        requireApprovalAboveThreshold: Boolean(policy.requireApprovalAboveThreshold),
        requireApprovalForFeatures: (policy.requireApprovalForFeatures as string[]) ?? [],
        adminBypassApproval: policy.adminBypassApproval !== false,
        dailySpendAlertUsd:
          policy.dailySpendAlertUsd == null ? "" : String(policy.dailySpendAlertUsd),
        monthlySpendAlertUsd:
          policy.monthlySpendAlertUsd == null ? "" : String(policy.monthlySpendAlertUsd),
        spendAlertThresholds: ((policy.spendAlertThresholds as number[]) ?? [50, 75, 90]).join(","),
        financeInAiEnabled: Boolean(policy.financeInAiEnabled),
      });
      setFinanceInAiAcceptedAt((policy.financeInAiAcceptedAt as string | null) ?? null);
      setFinanceInAiAckVersion((policy.financeInAiAckVersion as string | null) ?? null);
    } else {
      setForm(defaultForm);
      setFinanceInAiAcceptedAt(null);
      setFinanceInAiAckVersion(null);
    }
    setCatalogFinanceAckVersion(policyData.catalog?.financeInAiAckVersion ?? null);
    setFinanceInAiRiskAccepted(false);
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

  function onFinanceToggle(checked: boolean) {
    if (!checked) {
      setForm({ ...form, financeInAiEnabled: false });
      setFinanceInAiRiskAccepted(false);
      setFinanceRiskModalOpen(false);
      return;
    }
    if (financeAckCurrent || financeInAiRiskAccepted) {
      setForm({ ...form, financeInAiEnabled: true });
      return;
    }
    setFinanceRiskModalOpen(true);
  }

  function acceptFinanceRisks() {
    setFinanceInAiRiskAccepted(true);
    setForm((prev) => ({ ...prev, financeInAiEnabled: true }));
    setFinanceRiskModalOpen(false);
  }

  function dismissFinanceRisks() {
    setFinanceRiskModalOpen(false);
    setFinanceInAiRiskAccepted(false);
    setForm((prev) => ({ ...prev, financeInAiEnabled: false }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (form.financeInAiEnabled && !financeAckCurrent && !financeInAiRiskAccepted) {
      setFinanceRiskModalOpen(true);
      setMessage("Accept Finance-in-AI risks before enabling.");
      return;
    }
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
        financeInAiEnabled: form.financeInAiEnabled,
        financeInAiRiskAccepted: form.financeInAiEnabled
          ? financeInAiRiskAccepted || financeAckCurrent
          : false,
      }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "AI governance policy saved and audited." : (data.error ?? "Save failed"));
    setSaving(false);
    if (response.ok) await load();
  }

  async function decide(approvalId: string, decision: "approve" | "deny") {
    const response = await fetch("/api/organizations/ai-approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, approvalId, decision }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? decision === "approve"
          ? "Run approved — requester can retry within 24h (consumed once)."
          : "Run denied."
        : (data.error ?? "Decision failed"),
    );
    if (response.ok) await load();
  }

  const shell = classifyAiGovernanceShell({
    loading,
    status: httpStatus,
    error: loadError,
    policy: loading || loadError ? null : toSnapshot(form, pendingCount),
  });
  const shellCopy = aiGovernanceShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";
  const showEmptyBanner = shell === "empty" || shell === "setup";
  const metricsLoaded = !loading && !blocked;

  return (
    <main className="intel-app ai-governance-page">
      <header className="intel-header">
        <div>
          <span className="eyebrow">AI / GOVERNANCE</span>
          <h1>Org policy for models, tools, and spend</h1>
          <p className="app-muted">
            Control which assistant features and tools members may use, set absolute spend alerts, and
            require admin approval before high-cost runs. Model/provider allowlists live under Budgets;
            shared memory under Memory; enforcement happens in Chat.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Governance links">
          {headerLinks
            .filter((link) =>
              ["chat", "budgets", "memory", "finance", "usage", "runs", "admin"].includes(link.id),
            )
            .map((link) => (
              <a key={link.id} href={link.href}>
                {link.label}
              </a>
            ))}
        </nav>
      </header>

      <AiHubRelated orgId={orgId} active="governance" />
      <GovernanceRelatedStrip orgId={orgId} />

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <section className="app-card soft-panel product-hub-setup" aria-busy>
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
        </section>
      ) : null}

      {blocked ? (
        <section className="app-card soft-panel product-hub-setup" role="status">
          {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
          <NextActions orgId={orgId} shell={shell} />
          {shell === "error" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </section>
      ) : null}

      {!loading && !blocked ? (
        <>
          <section className="ai-governance-scope" aria-label="What governance owns">
            {AI_GOVERNANCE_SCOPE_CARDS.map((card) => (
              <article key={card.id} className="app-card soft-panel ai-governance-scope-card">
                <span className="eyebrow">
                  {card.id === "policy"
                    ? "POLICY"
                    : card.id === "budgets"
                      ? "BUDGETS"
                      : card.id === "memory"
                        ? "MEMORY"
                        : "CHAT"}
                </span>
                <h2>{card.title}</h2>
                <p className="app-muted">{card.body}</p>
                {card.id === "policy" ? (
                  <a className="app-button secondary" href="#ai-governance-policy">
                    Edit policy
                  </a>
                ) : null}
                {card.id === "budgets" ? (
                  <a className="app-button secondary" href={budgetsHref}>
                    Open Budgets
                  </a>
                ) : null}
                {card.id === "memory" ? (
                  <a className="app-button secondary" href={memoryHref}>
                    Open Memory
                  </a>
                ) : null}
                {card.id === "chat" ? (
                  <a className="app-button secondary" href={chatHref}>
                    Open Chat
                  </a>
                ) : null}
              </article>
            ))}
          </section>

          <section className="metric-grid" aria-label="Live spend and policy state">
            <article>
              <span>Spend today</span>
              <strong>{formatAiGovernanceMoney(usage.dailySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Spend this month</span>
              <strong>{formatAiGovernanceMoney(usage.monthlySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Pending approvals</span>
              <strong>{formatAiGovernanceCount(pendingCount, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Model allowlist</span>
              <strong>
                {metricsLoaded
                  ? budget?.modelAllowlistEnabled || budget?.providerAllowlistEnabled
                    ? "On"
                    : "Off"
                  : "…"}
              </strong>
            </article>
            <article>
              <span>Finance-in-AI</span>
              <strong>{metricsLoaded ? (form.financeInAiEnabled ? "On" : "Off") : "…"}</strong>
            </article>
          </section>

          {showEmptyBanner ? (
            <section className="app-card soft-panel product-hub-setup" role="status">
              {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
              <h2>{shellCopy.title}</h2>
              <p className="app-muted">{shellCopy.description}</p>
            </section>
          ) : null}

          <NextActions orgId={orgId} shell={shell} />

          <form
            id="ai-governance-policy"
            className="intel-panel auth-policy-form ai-governance-policy"
            onSubmit={save}
          >
            <span className="eyebrow">FEATURE &amp; TOOL POLICY</span>
            <p className="app-muted ai-governance-policy-lead">
              Org gates for metered AI capabilities. Empty Neon spend and empty approval queues stay empty —
              never DEMO policy stats. Model allowlists are edited on{" "}
              <a href={budgetsHref}>Budgets</a>.
            </p>
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
              {features.length === 0 ? (
                <p className="app-muted">No feature catalog loaded — save will keep the current list empty.</p>
              ) : (
                features.map((feature) => (
                  <label key={feature} className="check-field">
                    <input
                      type="checkbox"
                      checked={form.allowedFeatures.includes(feature)}
                      onChange={() =>
                        setForm({
                          ...form,
                          allowedFeatures: toggleList(form.allowedFeatures, feature),
                        })
                      }
                    />
                    {feature}
                  </label>
                ))
              )}
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
              {tools.length === 0 ? (
                <p className="app-muted">No tool catalog loaded — leave the allowlist off until catalog returns.</p>
              ) : (
                tools.map((tool) => (
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
                ))
              )}
            </div>

            <span className="eyebrow" style={{ marginTop: "1.25rem", display: "block" }}>
              FINANCE-IN-AI
            </span>
            <label className="state-control">
              <input
                type="checkbox"
                checked={form.financeInAiEnabled}
                onChange={(e) => onFinanceToggle(e.target.checked)}
              />
              <span>
                <strong>Allow AI to read team financial summaries</strong>
                <small>
                  Opt-in only. Assistants may use redacted budget and order context (amounts, vendor,
                  purpose) — card/bank/SSN patterns are stripped. Dedicated consent UI:{" "}
                  <a href={financeHref}>Finance-in-AI</a>.
                  {financeInAiAcceptedAt ? (
                    <>
                      {" "}
                      Last accepted {new Date(financeInAiAcceptedAt).toLocaleString()}
                      {financeInAiAckVersion ? ` · ack ${financeInAiAckVersion}` : ""}
                      {catalogFinanceAckVersion && financeInAiAckVersion !== catalogFinanceAckVersion
                        ? ` (catalog ${catalogFinanceAckVersion} — re-accept required)`
                        : ""}
                      .
                    </>
                  ) : null}
                </small>
              </span>
            </label>

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
                <small>
                  Uses the caller&apos;s estimatedCostUsd (CAD/research can pass real estimates). Set a
                  USD threshold below when this is on.
                </small>
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

            <div className="ai-governance-policy-actions">
              <button className="primary-action" disabled={saving} type="submit">
                {saving ? "Saving…" : "Save AI governance policy"}
              </button>
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
          </form>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">MODEL ALLOWLIST (FROM API BUDGETS)</span>
            <p className="app-muted">
              {budget?.modelAllowlistEnabled || budget?.providerAllowlistEnabled
                ? "Model/provider allowlist enforcement is on."
                : "Model/provider allowlist enforcement is off."}{" "}
              Edit on <a href={budgetsHref}>API budgets</a>
              {budget?.killSwitch ? " · Kill switch is active." : "."}
            </p>
            {models.length === 0 ? (
              <p className="app-muted">
                No per-model rules yet — an empty list is honest, not a DEMO allowlist.
              </p>
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

          <section className="intel-panel ai-governance-approvals" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">PENDING HIGH-COST APPROVALS</span>
            {approvals.length === 0 ? (
              <p className="app-muted">
                No pending approvals — the queue stays empty until a real high-cost run waits.
              </p>
            ) : (
              approvals.map((approval) => (
                <article key={approval.id}>
                  <strong>
                    {approval.feature}
                    {approval.provider ? ` · ${approval.provider}/${approval.model}` : ""}
                  </strong>
                  <small>
                    {approval.requesterName ?? "Member"}
                    {approval.requesterEmail ? ` · ${approval.requesterEmail}` : ""} · est.{" "}
                    {formatAiGovernanceMoney(approval.estimatedCostUsd, true)} ·{" "}
                    {approval.reason ?? "approval"}
                  </small>
                  <small>{new Date(approval.createdAt).toLocaleString()}</small>
                  <div className="ai-governance-approval-actions">
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
                    {approval.runId ? <a href={runsHref}>View runs</a> : null}
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      ) : null}

      {financeRiskModalOpen ? (
        <div
          className="edc-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finance-in-ai-risk-title"
        >
          <div>
            <header>
              <h2 id="finance-in-ai-risk-title">Accept Finance-in-AI risks</h2>
              <button type="button" aria-label="Close" onClick={dismissFinanceRisks}>
                ×
              </button>
            </header>
            <p className="edc-muted">
              AI is limited to pricing, amounts, vendor/source, and purpose/category. Never bank account
              numbers, full card numbers, routing, or SSN — those patterns are redacted before any model
              call.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <button type="button" className="primary-action" onClick={acceptFinanceRisks}>
                Accept and enable
              </button>
              <button type="button" onClick={dismissFinanceRisks}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
