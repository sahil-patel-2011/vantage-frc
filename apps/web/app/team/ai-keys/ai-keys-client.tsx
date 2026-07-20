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

type Payload = {
  tier: string;
  canManage: boolean;
  keys: ByokKeyStatus[];
  providers: ProviderMeta[];
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
  const [drafts, setDrafts] = useState<Record<ByokProvider, string>>({
    openai: "",
    anthropic: "",
    google: "",
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
        body: JSON.stringify({ orgId, provider, apiKey }),
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
        description="Bring your own OpenAI, Anthropic, or Google keys for Free workspaces. Paid plans add Vantage-hosted AI—cheaper than own keys—with Soft-UI product surfaces built in. Never DEMO usage totals."
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
              Custom OpenAI-compatible HTTPS endpoints and local desktop relays stay under{" "}
              <a href={orgId ? `${withOrgHref("/team/admin", orgId)}#custom-providers` : "/team/admin"}>
                Team admin → custom providers
              </a>
              .
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
        </>
      ) : null}
    </main>
  );
}
