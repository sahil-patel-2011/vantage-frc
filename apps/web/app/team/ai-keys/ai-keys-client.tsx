"use client";

import { useEffect, useState } from "react";
import { PageHeader, SoftBlockSkeleton } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import {
  AI_KEYS_RELATED_INCLUDE,
  aiKeysBillingNote,
  aiKeysRelatedLinks,
  aiKeysShellCopy,
  classifyAiKeysShell,
  type AiKeysShellKind,
} from "../../../lib/ai-keys/ai-keys-related";
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_META,
  type ByokKeyStatus,
  type ByokProvider,
} from "../../../lib/ai-keys/byok-providers";
import { withOrgHref } from "../../../lib/nav/product-nav";
import "./ai-keys.css";

type ProviderMeta = {
  id: ByokProvider;
  label: string;
  placeholder: string;
  docsHint: string;
};

type ModelOption = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  tier: string;
  tierLabel: string;
};

type LocalConnector = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
  lastTestedAt: string | null;
  reachabilityWarning: string | null;
};

type RoutingPrefs = {
  mode: "fixed" | "automode";
  fixedModelId: string | null;
  enabledModelIds: string[];
};

type Payload = {
  tier: string;
  canManage: boolean;
  keys: ByokKeyStatus[];
  providers: ProviderMeta[];
  localConnector?: LocalConnector;
  routing?: RoutingPrefs;
  modelOptions?: ModelOption[];
  setupRequired?: boolean;
  setupMessage?: string | null;
  error?: string;
};

function RelatedStrip({ orgId }: { orgId: string }) {
  const links = aiKeysRelatedLinks(orgId, { include: [...AI_KEYS_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-keys-related" aria-label="Related AI settings">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ShellPanel({
  shell,
  detail,
  orgId,
}: {
  shell: AiKeysShellKind;
  detail?: string | null;
  orgId: string | null;
}) {
  const copy = aiKeysShellCopy(shell, detail);
  return (
    <section className="app-card soft-panel ai-keys-shell" role="status">
      {copy.badge ? <span className="app-badge setup">{copy.badge}</span> : null}
      <span className="eyebrow">{copy.eyebrow}</span>
      <h2>{copy.title}</h2>
      <p className="app-muted">{copy.description}</p>
      {shell === "empty" ? (
        <a className="app-button primary" href="/workspace">
          Choose workspace
        </a>
      ) : null}
      {shell === "auth_required" ? (
        <a
          className="app-button primary"
          href={`/signin?next=${encodeURIComponent("/team/ai-keys")}`}
        >
          Sign in
        </a>
      ) : null}
      {shell === "setup" && orgId ? (
        <a className="app-button secondary" href={withOrgHref("/team/admin", orgId)}>
          Team admin
        </a>
      ) : null}
    </section>
  );
}

function ProviderCard({
  meta,
  status,
  canManage,
  setupBlocked,
  busy,
  draft,
  onDraft,
  onSave,
  onRemove,
}: {
  meta: ProviderMeta;
  status: ByokKeyStatus;
  canManage: boolean;
  setupBlocked: boolean;
  busy: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="app-card soft-panel ai-keys-provider" data-configured={status.configured ? "yes" : "no"}>
      <header className="ai-keys-provider-head">
        <div>
          <strong>{meta.label}</strong>
          <span className="app-muted">{meta.docsHint}</span>
        </div>
        <span className={`ai-keys-status ${status.configured ? "ok" : "missing"}`}>
          {status.configured ? "Configured" : "Missing"}
        </span>
      </header>

      {status.configured ? (
        <p className="ai-keys-meta app-muted">
          Encrypted at rest
          {status.createdAt ? ` · saved ${new Date(status.createdAt).toLocaleString()}` : ""}
          {status.lastUsedAt ? ` · last used ${new Date(status.lastUsedAt).toLocaleString()}` : ""}
          . Full secret is never shown again.
        </p>
      ) : (
        <p className="ai-keys-meta app-muted">No key stored for this provider yet.</p>
      )}

      {canManage && !setupBlocked ? (
        <form
          className="ai-keys-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <label>
            {status.configured ? "Replace API key" : "API key"}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={meta.placeholder}
              value={draft}
              disabled={busy}
              onChange={(event) => onDraft(event.target.value)}
              required={!status.configured}
            />
          </label>
          <div className="ai-keys-actions">
            <button className="primary-action" type="submit" disabled={busy || !draft.trim()}>
              {status.configured ? "Update & encrypt" : "Save & encrypt"}
            </button>
            {status.configured ? (
              <button
                className="danger-action"
                type="button"
                disabled={busy}
                onClick={() => onRemove()}
              >
                Remove key
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </article>
  );
}

export default function AiKeysClient({ orgId }: { orgId: string | null }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(orgId));
  const [busyProvider, setBusyProvider] = useState<ByokProvider | null>(null);
  const [busyLocal, setBusyLocal] = useState(false);
  const [busyRouting, setBusyRouting] = useState(false);
  const [drafts, setDrafts] = useState<Record<ByokProvider, string>>({
    openai: "",
    anthropic: "",
    google: "",
  });
  const [localDraft, setLocalDraft] = useState({ baseUrl: "", model: "llama3.2", apiKey: "" });
  const [routingDraft, setRoutingDraft] = useState<RoutingPrefs>({
    mode: "automode",
    fixedModelId: null,
    enabledModelIds: [],
  });

  async function load() {
    if (!orgId) {
      setLoading(false);
      setPayload(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/organizations/ai-keys?orgId=${encodeURIComponent(orgId)}`);
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load AI keys");
        setPayload(null);
      } else {
        setMessage("");
        setPayload(data);
        if (data.localConnector?.baseUrl) {
          setLocalDraft((prev) => ({
            ...prev,
            baseUrl: data.localConnector!.baseUrl ?? "",
            model: data.localConnector!.model ?? "llama3.2",
            apiKey: "",
          }));
        }
        if (data.routing) {
          setRoutingDraft(data.routing);
        } else if (data.modelOptions?.length) {
          setRoutingDraft({
            mode: "automode",
            fixedModelId: data.modelOptions[0]?.id ?? null,
            enabledModelIds: data.modelOptions.map((m) => m.id),
          });
        }
      }
    } catch {
      setMessage("Could not load AI keys");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when org changes
  }, [orgId]);

  async function save(provider: ByokProvider) {
    if (!orgId) return;
    const apiKey = drafts[provider].trim();
    if (!apiKey) return;
    setBusyProvider(provider);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "save_key", provider, apiKey }),
      });
      const data = (await response.json()) as { error?: string; setupRequired?: boolean };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save key");
        return;
      }
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      setMessage(`${BYOK_PROVIDER_META[provider].label} key encrypted and saved.`);
      await load();
    } finally {
      setBusyProvider(null);
    }
  }

  async function remove(provider: ByokProvider) {
    if (!orgId) return;
    if (!confirm(`Remove the ${BYOK_PROVIDER_META[provider].label} API key from this workspace?`)) return;
    setBusyProvider(provider);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, provider }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not remove key");
        return;
      }
      setMessage(`${BYOK_PROVIDER_META[provider].label} key removed.`);
      await load();
    } finally {
      setBusyProvider(null);
    }
  }

  async function saveLocal() {
    if (!orgId) return;
    setBusyLocal(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "save_local",
          baseUrl: localDraft.baseUrl,
          model: localDraft.model,
          apiKey: localDraft.apiKey,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        reachabilityWarning?: string | null;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save local connector");
        return;
      }
      setLocalDraft((prev) => ({ ...prev, apiKey: "" }));
      setMessage(
        data.reachabilityWarning
          ? `Local connector saved. ${data.reachabilityWarning}`
          : "Local OpenAI-compatible connector encrypted and saved.",
      );
      await load();
    } finally {
      setBusyLocal(false);
    }
  }

  async function testLocal() {
    if (!orgId) return;
    setBusyLocal(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "test_local" }),
      });
      const data = (await response.json()) as { error?: string; reachabilityWarning?: string | null };
      if (!response.ok) {
        setMessage(data.error ?? "Connection test failed");
        return;
      }
      setMessage(
        data.reachabilityWarning
          ? `Connection ok. ${data.reachabilityWarning}`
          : "Connection test succeeded.",
      );
      await load();
    } finally {
      setBusyLocal(false);
    }
  }

  async function removeLocal() {
    if (!orgId) return;
    if (!confirm("Remove the local OpenAI-compatible connector?")) return;
    setBusyLocal(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "remove_local" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not remove local connector");
        return;
      }
      setLocalDraft({ baseUrl: "", model: "llama3.2", apiKey: "" });
      setMessage("Local connector removed.");
      await load();
    } finally {
      setBusyLocal(false);
    }
  }

  async function saveRouting() {
    if (!orgId) return;
    setBusyRouting(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "save_routing",
          mode: routingDraft.mode,
          fixedModelId: routingDraft.fixedModelId,
          enabledModelIds: routingDraft.enabledModelIds,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save model routing");
        return;
      }
      setMessage(
        routingDraft.mode === "fixed"
          ? "Fixed model saved — every BYOK call uses that model."
          : "Automode saved — CAD/Code use high reasoning; Strategy uses strong mid; light chat uses fast models from your pool.",
      );
      await load();
    } finally {
      setBusyRouting(false);
    }
  }

  const shell = classifyAiKeysShell({
    loading,
    hasOrg: Boolean(orgId),
    setupRequired: Boolean(payload?.setupRequired),
    forbidden: payload ? !payload.canManage : false,
    error: message && !payload ? message : "",
  });

  const billing = aiKeysBillingNote(payload?.tier);
  const statusByProvider = new Map((payload?.keys ?? []).map((row) => [row.provider, row]));
  const providerMeta =
    payload?.providers ??
    BYOK_PROVIDERS.map((id) => ({
      id,
      label: BYOK_PROVIDER_META[id].label,
      placeholder: BYOK_PROVIDER_META[id].placeholder,
      docsHint: BYOK_PROVIDER_META[id].docsHint,
    }));
  const modelOptions = payload?.modelOptions ?? [];
  const configuredProviders = new Set<string>(
    (payload?.keys ?? []).filter((k) => k.configured).map((k) => k.provider),
  );
  if (payload?.localConnector?.configured) configuredProviders.add("openai-compatible");

  const aiHubHref = hubHref("/ai", "chat", orgId);

  return (
    <main className="module-page ai-keys-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHubHref}>AI</a>
            {" / API keys"}
          </>
        }
        navPath="/team/ai-keys"
        title="AI API keys"
        description="Bring your own OpenAI, Anthropic, Google, or local OpenAI-compatible server. Fixed model or Automode by task toughness. Never DEMO usage totals."
      />

      {orgId ? <RelatedStrip orgId={orgId} /> : null}

      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading AI API keys">
          <SoftBlockSkeleton lines={3} />
        </div>
      ) : null}

      {shell === "empty" || shell === "auth_required" || (shell === "error" && !payload) ? (
        <ShellPanel shell={shell} detail={message} orgId={orgId} />
      ) : null}

      {payload?.setupRequired ? (
        <ShellPanel shell="setup" detail={payload.setupMessage} orgId={orgId} />
      ) : null}

      {payload && !payload.setupRequired ? (
        <>
          <section className="app-card soft-panel ai-keys-billing" aria-label="Hosting vs your keys">
            <span className="eyebrow">{billing.title}</span>
            <p>{billing.body}</p>
            <p className="app-muted">
              Track BYOK call estimates on{" "}
              <a href={orgId ? withOrgHref("/team/ai-usage", orgId) : "/team/ai-usage"}>BYOK usage</a>
              . Hosted 0.75× metering still applies when no BYOK path is configured.
            </p>
          </section>

          {!payload.canManage ? (
            <ShellPanel
              shell="forbidden"
              detail="You can see configured / missing status. Ask an owner or admin with Manage API keys to paste or remove secrets."
              orgId={orgId}
            />
          ) : null}

          {message ? (
            <p className="ai-keys-flash" role="status">
              {message}
            </p>
          ) : null}

          <section className="ai-keys-grid" aria-label="Provider API keys">
            {providerMeta.map((meta) => {
              const status = statusByProvider.get(meta.id) ?? {
                provider: meta.id,
                label: meta.label,
                configured: false,
                createdAt: null,
                lastUsedAt: null,
              };
              return (
                <ProviderCard
                  key={meta.id}
                  meta={meta}
                  status={status}
                  canManage={payload.canManage}
                  setupBlocked={Boolean(payload.setupRequired)}
                  busy={busyProvider === meta.id}
                  draft={drafts[meta.id]}
                  onDraft={(value) => setDrafts((prev) => ({ ...prev, [meta.id]: value }))}
                  onSave={() => void save(meta.id)}
                  onRemove={() => void remove(meta.id)}
                />
              );
            })}
          </section>

          <section className="app-card soft-panel ai-keys-local" aria-label="Local OpenAI-compatible connector">
            <span className="eyebrow">LOCAL / OPENAI-COMPATIBLE</span>
            <h2>Ollama / LM Studio</h2>
            <p className="app-muted">
              Set a base URL such as <code>http://localhost:11434/v1</code> (Ollama) or your LM Studio
              OpenAI-compatible URL. Optional API key (often empty or <code>lm-studio</code>).
              Cloud Vantage cannot call your laptop&apos;s localhost — use a tunnel or self-hosted
              gateway with a reachable HTTPS URL.
            </p>
            {payload.localConnector?.configured ? (
              <p className="ai-keys-meta app-muted">
                Configured
                {payload.localConnector.hasKey ? " · key stored" : " · no key"}
                {payload.localConnector.lastTestedAt
                  ? ` · tested ${new Date(payload.localConnector.lastTestedAt).toLocaleString()}`
                  : " · not tested"}
                .
              </p>
            ) : null}
            {payload.localConnector?.reachabilityWarning ? (
              <p className="ai-keys-warn" role="note">
                {payload.localConnector.reachabilityWarning}
              </p>
            ) : null}
            {payload.canManage ? (
              <form
                className="ai-keys-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLocal();
                }}
              >
                <label>
                  Base URL
                  <input
                    type="url"
                    required
                    placeholder="http://localhost:11434/v1"
                    value={localDraft.baseUrl}
                    disabled={busyLocal}
                    onChange={(e) => setLocalDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  />
                </label>
                <label>
                  Default model id
                  <input
                    required
                    placeholder="llama3.2"
                    value={localDraft.model}
                    disabled={busyLocal}
                    onChange={(e) => setLocalDraft((prev) => ({ ...prev, model: e.target.value }))}
                  />
                </label>
                <label>
                  Optional API key
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="lm-studio or leave blank"
                    value={localDraft.apiKey}
                    disabled={busyLocal}
                    onChange={(e) => setLocalDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                  />
                </label>
                <div className="ai-keys-actions">
                  <button className="primary-action" type="submit" disabled={busyLocal || !localDraft.baseUrl.trim()}>
                    Save connector
                  </button>
                  {payload.localConnector?.configured ? (
                    <>
                      <button type="button" disabled={busyLocal} onClick={() => void testLocal()}>
                        Test connection
                      </button>
                      <button className="danger-action" type="button" disabled={busyLocal} onClick={() => void removeLocal()}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </form>
            ) : null}
          </section>

          <section className="app-card soft-panel ai-keys-routing" aria-label="Model routing">
            <span className="eyebrow">MODEL ROUTING</span>
            <h2>Fixed model or Automode</h2>
            <p className="app-muted">
              Automode picks from your enabled pool by task toughness: CAD and Code → high reasoning;
              Strategy → strong mid; light chat → fast. Only models for providers you have keyed
              (or a local connector) are eligible. Model ids are the real API strings below — not
              hosted display names like &quot;GPT 5.6 Sol&quot;.
            </p>
            {payload.canManage && modelOptions.length ? (
              <form
                className="ai-keys-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRouting();
                }}
              >
                <fieldset className="ai-keys-mode">
                  <legend>Mode</legend>
                  <label className="check-field">
                    <input
                      type="radio"
                      name="byok-mode"
                      checked={routingDraft.mode === "fixed"}
                      onChange={() => setRoutingDraft((prev) => ({ ...prev, mode: "fixed" }))}
                    />{" "}
                    Fixed model — always use one model
                  </label>
                  <label className="check-field">
                    <input
                      type="radio"
                      name="byok-mode"
                      checked={routingDraft.mode === "automode"}
                      onChange={() => setRoutingDraft((prev) => ({ ...prev, mode: "automode" }))}
                    />{" "}
                    Automode — route by feature toughness
                  </label>
                </fieldset>

                {routingDraft.mode === "fixed" ? (
                  <label>
                    Fixed model
                    <select
                      value={routingDraft.fixedModelId ?? ""}
                      onChange={(e) =>
                        setRoutingDraft((prev) => ({ ...prev, fixedModelId: e.target.value || null }))
                      }
                    >
                      {modelOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label} · {opt.tierLabel} ({opt.modelId})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <fieldset className="ai-keys-pool">
                    <legend>Automode pool</legend>
                    {modelOptions.map((opt) => {
                      const checked = routingDraft.enabledModelIds.includes(opt.id);
                      const providerReady =
                        opt.provider === "openai-compatible"
                          ? Boolean(payload.localConnector?.configured)
                          : configuredProviders.has(opt.provider);
                      return (
                        <label key={opt.id} className="check-field">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRoutingDraft((prev) => ({
                                ...prev,
                                enabledModelIds: checked
                                  ? prev.enabledModelIds.filter((id) => id !== opt.id)
                                  : [...prev.enabledModelIds, opt.id],
                              }))
                            }
                          />{" "}
                          <strong>{opt.label}</strong>
                          <span className="app-muted">
                            {" "}
                            · {opt.tierLabel} · <code>{opt.modelId}</code>
                            {!providerReady ? " · add provider key to use" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}

                <div className="ai-keys-actions">
                  <button className="primary-action" type="submit" disabled={busyRouting}>
                    Save routing
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
