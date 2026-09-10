"use client";

import { useEffect, useState } from "react";
import { PageHeader, SoftBlockSkeleton } from "../../../components/ui";
import { SponsoredPromoBanner } from "../../../components/sponsored-promo-banner";
import { hubHref } from "../../../lib/nav/hubs";
import {
  aiKeysBillingNote,
  classifyAiKeysShell,
} from "../../../lib/ai-keys/ai-keys-related";
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_META,
  type ByokProvider,
} from "../../../lib/ai-keys/byok-providers";
import { describeModelPolicy } from "../../../lib/ai-keys/model-policy-related";
import { PAGE_DESCRIPTION } from "./ai-keys-copy";
import { LoadFailurePanel, RelatedStrip, ShellPanel } from "./ai-keys-chrome";
import {
  type ModelPolicyMode,
  type ModelPolicyPayload,
  type Payload,
  type RoutingPrefs,
} from "./ai-keys-model";
import { AiKeysReadyView } from "./ai-keys-ready-view";
import "./ai-keys.css";

export default function AiKeysClient({ orgId }: { orgId: string | null }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [busyProvider, setBusyProvider] = useState<ByokProvider | null>(null);
  const [busyLocal, setBusyLocal] = useState(false);
  const [busyRouting, setBusyRouting] = useState(false);
  const [drafts, setDrafts] = useState<Record<ByokProvider, string>>({
    openai: "",
    anthropic: "",
    google: "",
    openrouter: "",
  });
  const [localDraft, setLocalDraft] = useState({ baseUrl: "", model: "llama3.2", apiKey: "" });
  const [routingDraft, setRoutingDraft] = useState<RoutingPrefs>({
    mode: "automode",
    fixedModelId: null,
    enabledModelIds: [],
  });
  const [modelPolicy, setModelPolicy] = useState<ModelPolicyPayload | null>(null);
  const [policyDraft, setPolicyDraft] = useState<{ mode: ModelPolicyMode; allowedModelIds: string[] }>({
    mode: "allow_all",
    allowedModelIds: [],
  });
  const [busyPolicy, setBusyPolicy] = useState(false);
  // Member preview of the shared selector — controlled locally; each product
  // surface persists its own choice, this shows the policy's effect live.
  const [myModelChoice, setMyModelChoice] = useState<string | null>(null);

  async function loadModelPolicy() {
    if (!orgId) {
      setModelPolicy(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/organizations/model-policy?orgId=${encodeURIComponent(orgId)}`,
      );
      if (!response.ok) {
        setModelPolicy(null);
        return;
      }
      const data = (await response.json()) as ModelPolicyPayload;
      setModelPolicy(data);
      setPolicyDraft({ mode: data.mode, allowedModelIds: data.allowedModelIds });
    } catch {
      setModelPolicy(null);
    }
  }

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
        setErrorStatus(response.status);
        setPayload(null);
      } else {
        setMessage("");
        setErrorStatus(null);
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
      setErrorStatus(null);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadModelPolicy();
     
  }, [orgId]);

  async function saveModelPolicy() {
    if (!orgId) return;
    setBusyPolicy(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/model-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          mode: policyDraft.mode,
          allowedModelIds: policyDraft.mode === "allowlist" ? policyDraft.allowedModelIds : undefined,
        }),
      });
      const data = (await response.json()) as ModelPolicyPayload & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save the model policy");
        return;
      }
      setModelPolicy(data);
      setPolicyDraft({ mode: data.mode, allowedModelIds: data.allowedModelIds });
      setMessage(
        `Model policy saved — ${describeModelPolicy(data.mode, data.allowedModelIds.length)}`,
      );
    } finally {
      setBusyPolicy(false);
    }
  }

  const [mineDraft, setMineDraft] = useState({ provider: "openai", apiKey: "", baseUrl: "", model: "" });
  const [mineBusy, setMineBusy] = useState(false);

  async function saveMemberKey() {
    if (!orgId || !mineDraft.apiKey.trim()) return;
    setMineBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "save_member_key",
          provider: mineDraft.provider,
          apiKey: mineDraft.apiKey,
          baseUrl: mineDraft.baseUrl || undefined,
          model: mineDraft.model || undefined,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save your personal key");
        return;
      }
      setMineDraft((d) => ({ ...d, apiKey: "" }));
      setMessage("Personal key saved - your AI calls now use it instead of the team key.");
      void load();
    } finally {
      setMineBusy(false);
    }
  }

  async function removeMemberKey(provider: string) {
    if (!orgId) return;
    setMineBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "remove_member_key", provider }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not remove your personal key");
        return;
      }
      setMessage("Personal key removed - back to the team key.");
      void load();
    } finally {
      setMineBusy(false);
    }
  }

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
    if (!confirm(`Remove the ${BYOK_PROVIDER_META[provider].label} API key from this team?`)) return;
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
          ? "Fixed model saved — every call with your keys uses that model."
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
        description={PAGE_DESCRIPTION}
      >
      </PageHeader>

      {orgId ? <RelatedStrip orgId={orgId} /> : null}
      {orgId ? <SponsoredPromoBanner orgId={orgId} /> : null}

      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading AI API keys">
          <SoftBlockSkeleton lines={3} />
        </div>
      ) : null}

      {shell === "empty" || shell === "auth_required" ? (
        <ShellPanel shell={shell} detail={message} orgId={orgId} />
      ) : null}

      {shell === "error" && !payload ? (
        <LoadFailurePanel status={errorStatus} message={message} onRetry={() => void load()} />
      ) : null}

      {payload?.setupRequired ? (
        <ShellPanel shell="setup" detail={payload.setupMessage} orgId={orgId} />
      ) : null}


      {payload && !payload.setupRequired ? (
        <AiKeysReadyView
          orgId={orgId}
          payload={payload}
          billing={billing}
          mineDraft={mineDraft}
          setMineDraft={setMineDraft}
          mineBusy={mineBusy}
          saveMemberKey={() => void saveMemberKey()}
          removeMemberKey={(provider) => void removeMemberKey(provider)}
          message={message}
          providerMeta={providerMeta}
          statusByProvider={statusByProvider}
          busyProvider={busyProvider}
          drafts={drafts}
          setDrafts={setDrafts}
          save={(provider) => void save(provider)}
          remove={(provider) => void remove(provider)}
          localDraft={localDraft}
          setLocalDraft={setLocalDraft}
          busyLocal={busyLocal}
          saveLocal={() => void saveLocal()}
          testLocal={() => void testLocal()}
          removeLocal={() => void removeLocal()}
          routingDraft={routingDraft}
          setRoutingDraft={setRoutingDraft}
          busyRouting={busyRouting}
          saveRouting={() => void saveRouting()}
          modelOptions={modelOptions}
          configuredProviders={configuredProviders}
          modelPolicy={modelPolicy}
          policyDraft={policyDraft}
          setPolicyDraft={setPolicyDraft}
          busyPolicy={busyPolicy}
          saveModelPolicy={() => void saveModelPolicy()}
          myModelChoice={myModelChoice}
          setMyModelChoice={setMyModelChoice}
        />
      ) : null}
    </main>
  );
}
