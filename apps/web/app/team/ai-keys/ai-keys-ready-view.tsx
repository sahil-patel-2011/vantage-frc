"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Button } from "../../../components/ui";
import { ModelSelector } from "../../../components/model-selector";
import { BYOK_PROVIDER_META, type ByokProvider } from "../../../lib/ai-keys/byok-providers";
import { MODEL_POLICY_MODE_META } from "../../../lib/ai-keys/model-policy-related";
import { FREE_KEY_CAVEAT, FREE_KEY_PROVIDERS } from "../../../lib/ai-keys/free-key-providers";
import { withOrgHref } from "../../../lib/nav/product-nav";
import {
  ANY_ENDPOINT_BODY,
  ANY_ENDPOINT_HEADLINE,
  ANY_ENDPOINT_POINTS,
  describeMemberKey,
  ENDPOINT_EXAMPLES,
  MEMBER_KEY_BASE_URL_HINT,
  MEMBER_KEY_BODY,
  MEMBER_KEY_HEADLINE,
  MEMBER_KEY_MODEL_HINT,
  memberKeyFields,
} from "./ai-keys-copy";
import { ShellPanel } from "./ai-keys-chrome";
import {
  type LocalDraft,
  type MineDraft,
  type ModelOption,
  type ModelPolicyMode,
  type ModelPolicyPayload,
  type Payload,
  type ProviderMeta,
  type RoutingPrefs,
} from "./ai-keys-model";
import { ProviderCard } from "./ai-keys-provider-card";

export type AiKeysReadyViewProps = {
  orgId: string | null;
  payload: Payload;
  billing: { title: string; body: string };
  mineDraft: MineDraft;
  setMineDraft: Dispatch<SetStateAction<MineDraft>>;
  mineBusy: boolean;
  saveMemberKey: () => void;
  removeMemberKey: (provider: string) => void;
  message: string;
  providerMeta: ProviderMeta[];
  statusByProvider: Map<string, Payload["keys"][number]>;
  busyProvider: ByokProvider | null;
  drafts: Record<ByokProvider, string>;
  setDrafts: Dispatch<SetStateAction<Record<ByokProvider, string>>>;
  save: (provider: ByokProvider) => void;
  remove: (provider: ByokProvider) => void;
  localDraft: LocalDraft;
  setLocalDraft: Dispatch<SetStateAction<LocalDraft>>;
  busyLocal: boolean;
  saveLocal: () => void;
  testLocal: () => void;
  removeLocal: () => void;
  routingDraft: RoutingPrefs;
  setRoutingDraft: Dispatch<SetStateAction<RoutingPrefs>>;
  busyRouting: boolean;
  saveRouting: () => void;
  modelOptions: ModelOption[];
  configuredProviders: Set<string>;
  modelPolicy: ModelPolicyPayload | null;
  policyDraft: { mode: ModelPolicyMode; allowedModelIds: string[] };
  setPolicyDraft: Dispatch<SetStateAction<{ mode: ModelPolicyMode; allowedModelIds: string[] }>>;
  busyPolicy: boolean;
  saveModelPolicy: () => void;
  myModelChoice: string | null;
  setMyModelChoice: Dispatch<SetStateAction<string | null>>;
};

export function AiKeysReadyView(props: AiKeysReadyViewProps) {
  const {
    orgId,
    payload,
    billing,
    mineDraft,
    setMineDraft,
    mineBusy,
    saveMemberKey,
    removeMemberKey,
    message,
    providerMeta,
    statusByProvider,
    busyProvider,
    drafts,
    setDrafts,
    save,
    remove,
    localDraft,
    setLocalDraft,
    busyLocal,
    saveLocal,
    testLocal,
    removeLocal,
    routingDraft,
    setRoutingDraft,
    busyRouting,
    saveRouting,
    modelOptions,
    configuredProviders,
    modelPolicy,
    policyDraft,
    setPolicyDraft,
    busyPolicy,
    saveModelPolicy,
    myModelChoice,
    setMyModelChoice,
  } = props;
  return (
    <>
          <section className="app-card soft-panel ai-keys-billing" aria-label="Hosting vs your keys">
            <span className="eyebrow">{billing.title}</span>
            <p>{billing.body}</p>
            <p className="app-muted">
              Track your-key call estimates on{" "}
              <a href={orgId ? withOrgHref("/team/ai-usage", orgId) : "/team/ai-usage"}>Your keys usage</a>
              . Hosted 0.75× metering still applies when no team key is configured.
            </p>
          </section>

          {/* The promise this page exists to make, stated before any of the
              provider-specific machinery below it: the endpoint is the team's
              choice, and the choice does not gate features. Copy lives in
              ./ai-keys-copy.ts so the promises stay pinned by tests. */}
          <section className="app-card soft-panel ai-keys-any" aria-label="Bring any endpoint">
            <span className="eyebrow">BRING ANY ENDPOINT</span>
            <h2>{ANY_ENDPOINT_HEADLINE}</h2>
            <p className="app-muted">{ANY_ENDPOINT_BODY}</p>
            <ul className="ai-keys-any-points">
              {ANY_ENDPOINT_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <details className="ai-keys-any-examples">
              <summary>Where does each one go?</summary>
              <ul>
                {ENDPOINT_EXAMPLES.map((example) => (
                  <li key={example.id}>
                    <strong>{example.name}</strong>
                    <span className="app-muted"> — {example.howToUse}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="app-card soft-panel ai-keys-mine" aria-label="My personal AI keys">
            <span className="eyebrow">MINE</span>
            <h2>{MEMBER_KEY_HEADLINE}</h2>
            <p className="app-muted">{MEMBER_KEY_BODY}</p>
            {(payload.memberKeys ?? []).length ? (
              <ul className="ai-keys-mine-list">
                {(payload.memberKeys ?? []).map((row) => (
                  <li key={row.provider}>
                    <div>
                      <strong>{BYOK_PROVIDER_META[row.provider as ByokProvider]?.label ?? row.provider}</strong>
                      {/* describeMemberKey never guesses: an unset base URL or
                          model is named as the inherited default, not invented. */}
                      <small className="app-muted">
                        {` ${describeMemberKey(row)}`}
                        {row.lastUsedAt
                          ? ` · last used ${new Date(row.lastUsedAt).toLocaleDateString()}`
                          : " · not used yet"}
                      </small>
                    </div>
                    <Button variant="secondary" type="button" disabled={mineBusy} onClick={() => void removeMemberKey(row.provider)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No personal keys yet. The team key (if any) answers for you.</p>
            )}
            <form
              className="ai-keys-mine-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveMemberKey();
              }}
            >
              <label>
                Provider
                <select
                  value={mineDraft.provider}
                  onChange={(event) => {
                    const provider = event.target.value;
                    // Drop a base URL the new provider cannot use, so nothing is
                    // submitted that the route would silently discard.
                    setMineDraft((d) => ({
                      ...d,
                      provider,
                      baseUrl: memberKeyFields(provider).baseUrl ? d.baseUrl : "",
                    }));
                  }}
                >
                  <option value="openai">OpenAI / any compatible endpoint</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google AI Studio</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={mineDraft.apiKey}
                  autoComplete="off"
                  onChange={(event) => setMineDraft((d) => ({ ...d, apiKey: event.target.value }))}
                  placeholder="Paste your key"
                />
              </label>
              {/* Field parity with the team form, driven by what the route
                  actually stores: a base URL on the OpenAI-compatible slot, a
                  model id on every provider (0442's columns). Offering a field
                  the route drops would be a promise we do not keep. */}
              {memberKeyFields(mineDraft.provider).baseUrl ? (
                <label>
                  Base URL
                  <input
                    type="url"
                    value={mineDraft.baseUrl}
                    onChange={(event) => setMineDraft((d) => ({ ...d, baseUrl: event.target.value }))}
                    placeholder="https://api.groq.com/openai/v1"
                  />
                  <small className="app-muted">{MEMBER_KEY_BASE_URL_HINT}</small>
                </label>
              ) : null}
              {memberKeyFields(mineDraft.provider).model ? (
                <label>
                  Model
                  <input
                    type="text"
                    value={mineDraft.model}
                    onChange={(event) => setMineDraft((d) => ({ ...d, model: event.target.value }))}
                    placeholder="llama-3.3-70b-versatile"
                  />
                  <small className="app-muted">{MEMBER_KEY_MODEL_HINT}</small>
                </label>
              ) : null}
              <Button variant="primary" type="submit" disabled={mineBusy || !mineDraft.apiKey.trim()}>
                {mineBusy ? "Saving…" : "Save my key"}
              </Button>
            </form>
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

          <section className="app-card soft-panel ai-keys-local" aria-label="Local connector">
            <span className="eyebrow">LOCAL CONNECTOR</span>
            <h2>Ollama / LM Studio</h2>
            <p className="app-muted">
              Set a base URL such as <code>http://localhost:11434/v1</code> (Ollama) or your LM Studio
              local connector URL. Optional API key (often empty or <code>lm-studio</code>).
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
                  <Button variant="primary" type="submit" disabled={busyLocal || !localDraft.baseUrl.trim()}>
                    Save connector
                  </Button>
                  {payload.localConnector?.configured ? (
                    <>
                      <Button variant="secondary" type="button" disabled={busyLocal} onClick={() => void testLocal()}>
                        Test connection
                      </Button>
                      <Button variant="danger" type="button" disabled={busyLocal} onClick={() => void removeLocal()}>
                        Remove
                      </Button>
                    </>
                  ) : null}
                </div>
              </form>
            ) : null}
          </section>

          <section className="app-card soft-panel ai-keys-free" aria-label="Free API key providers">
            <span className="eyebrow">FREE API KEYS</span>
            <h2>No budget? Start with a free key</h2>
            <p className="app-muted">
              These providers currently offer free API tiers that work as Team or personal keys.
              {" "}{FREE_KEY_CAVEAT}
            </p>
            <ul className="ai-keys-free-list">
              {FREE_KEY_PROVIDERS.map((provider) => (
                <li key={provider.id}>
                  <div>
                    <strong>
                      <a href={provider.signupUrl} target="_blank" rel="noreferrer noopener">
                        {provider.name}
                      </a>
                    </strong>
                    <span className="app-muted"> — {provider.note}</span>
                  </div>
                  <small className="app-muted">
                    Use as: {provider.byokProvider}
                    {provider.baseUrl ? (
                      <>
                        {" "}· base URL <code>{provider.baseUrl}</code>
                      </>
                    ) : null}
                  </small>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-card soft-panel ai-keys-routing" aria-label="Model routing">
            <span className="eyebrow">ROUTING</span>
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
                  <Button variant="primary" type="submit" disabled={busyRouting}>
                    Save routing
                  </Button>
                </div>
              </form>
            ) : null}
          </section>

          {modelPolicy?.canManage ? (
            <section className="app-card soft-panel ai-keys-model-policy" aria-label="Model policy">
              <span className="eyebrow">POLICY</span>
              <h2>Which models members may pick</h2>
              <p className="app-muted">
                Selection policy for the whole team, app-wide. Separate from API spend limits —
                this only controls what shows up in model pickers. A pick that a new policy no
                longer allows quietly falls back to the best allowed model; nothing errors mid-chat.
              </p>
              <form
                className="ai-keys-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveModelPolicy();
                }}
              >
                <fieldset className="ai-keys-mode">
                  <legend>Policy</legend>
                  {(Object.keys(MODEL_POLICY_MODE_META) as ModelPolicyMode[]).map((mode) => (
                    <label key={mode} className="check-field">
                      <input
                        type="radio"
                        name="model-policy-mode"
                        checked={policyDraft.mode === mode}
                        onChange={() => setPolicyDraft((prev) => ({ ...prev, mode }))}
                      />{" "}
                      <strong>{MODEL_POLICY_MODE_META[mode].label}</strong>
                      <span className="app-muted"> · {MODEL_POLICY_MODE_META[mode].description}</span>
                    </label>
                  ))}
                </fieldset>

                {policyDraft.mode === "allowlist" ? (
                  <fieldset className="ai-keys-pool">
                    <legend>Allowed models</legend>
                    {modelPolicy.catalog.map((opt) => {
                      const checked = policyDraft.allowedModelIds.includes(opt.id);
                      return (
                        <label key={opt.id} className="check-field">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPolicyDraft((prev) => ({
                                ...prev,
                                allowedModelIds: checked
                                  ? prev.allowedModelIds.filter((id) => id !== opt.id)
                                  : [...prev.allowedModelIds, opt.id],
                              }))
                            }
                          />{" "}
                          <strong>{opt.label}</strong>
                          <span className="app-muted">
                            {" "}
                            · {opt.tierLabel} · <code>{opt.modelId}</code>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}

                <div className="ai-keys-actions">
                  <Button variant="primary" type="submit" disabled={busyPolicy}>
                    Save policy
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="app-card soft-panel ai-keys-my-model" aria-label="My model">
            <span className="eyebrow">MINE</span>
            <h2>My model</h2>
            <p className="app-muted">
              What you may pick under the current team policy. The same selector (and policy)
              applies in every product surface where you choose a model.
            </p>
            <ModelSelector
              orgId={orgId}
              value={myModelChoice}
              onChange={setMyModelChoice}
              label="My model"
            />
          </section>
    </>
  );
}
