"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Button, askConfirm } from "../../../components/ui";
import { ModelSelector } from "../../../components/model-selector";
import { BYOK_PROVIDER_META, type ByokProvider } from "../../../lib/ai-keys/byok-providers";
import { formatModelList, matchModelList, modelTokens } from "../../../lib/ai-keys/model-list";
import { MODEL_POLICY_MODE_META } from "../../../lib/ai-keys/model-policy-related";
import { FREE_KEY_CAVEAT, FREE_KEY_PROVIDERS } from "../../../lib/ai-keys/free-key-providers";
import { withOrgHref } from "../../../lib/nav/product-nav";
import {
  ANY_ENDPOINT_BODY,
  ANY_ENDPOINT_HEADLINE,
  ANY_ENDPOINT_POINTS,
  describeMemberKey,
  MEMBER_KEY_BASE_URL_HINT,
  MEMBER_KEY_BODY,
  MEMBER_KEY_HEADLINE,
  memberKeyFields,
  OTHER_KEYS_TITLE,
} from "./ai-keys-copy";
import { ShellPanel } from "./ai-keys-chrome";
import {
  type LocalDraft,
  type MineDraft,
  type FreeSwarm,
  type ModelOption,
  type ModelPolicyMode,
  type ModelPolicyPayload,
  type Payload,
  type ProviderMeta,
  type RoutingPrefs,
} from "./ai-keys-model";
import { MyFreeGeminiKey } from "./ai-keys-my-free-key";
import { AiKeySharing } from "./ai-key-sharing";
import { TeamKeyList } from "./ai-keys-team-list";
import { ModelSelect } from "./ai-keys-model-select";
import { KeySpendMeter } from "./ai-key-spend";
import { AiCreditLine } from "../../../components/ai-credit-line";
import { WebResearchCard } from "./ai-keys-web-research";
import { AiTrainingCard } from "./ai-training-card";

const GEMINI_FREE = FREE_KEY_PROVIDERS.find((provider) => provider.byokProvider === "google") ?? null;

export type AiKeysReadyViewProps = {
  orgId: string | null;
  payload: Payload;
  billing: { title: string; body: string };
  mineDraft: MineDraft;
  setMineDraft: Dispatch<SetStateAction<MineDraft>>;
  mineBusy: boolean;
  saveMemberKey: () => void;
  saveMyGoogleKey: (apiKey: string) => Promise<boolean>;
  removeMemberKey: (provider: string, keyId?: string) => void;
  message: string;
  messageIsError?: boolean;
  keyError?: { provider: ByokProvider; message: string } | null;
  providerMeta: ProviderMeta[];
  statusByProvider: Map<string, Payload["keys"][number]>;
  busyProvider: ByokProvider | null;
  drafts: Record<ByokProvider, string>;
  setDrafts: Dispatch<SetStateAction<Record<ByokProvider, string>>>;
  save: (provider: ByokProvider) => void;
  remove: (provider: ByokProvider) => void;
  /** Reload the page's data after a key changes. */
  reload: () => Promise<void> | void;
  /** Say what happened, in the page's message line. */
  notify: (message: string, isError?: boolean) => void;
  localDraft: LocalDraft;
  setLocalDraft: Dispatch<SetStateAction<LocalDraft>>;
  busyLocal: boolean;
  saveLocal: () => void;
  testLocal: () => void;
  removeLocal: () => void;
  routingDraft: RoutingPrefs;
  setRoutingDraft: Dispatch<SetStateAction<RoutingPrefs>>;
  busyRouting: boolean;
  saveRouting: (modelsText?: string) => void;
  modelOptions: ModelOption[];
  freeSwarm: FreeSwarm | null;
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
    saveMyGoogleKey,
    removeMemberKey,
    message,
    messageIsError,
    keyError,
    providerMeta,
    busyProvider,
    drafts,
    setDrafts,
    save,
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
    freeSwarm,
    configuredProviders,
    modelPolicy,
    policyDraft,
    setPolicyDraft,
    busyPolicy,
    saveModelPolicy,
    myModelChoice,
    setMyModelChoice,
  } = props;
  const showStart = Boolean(payload.canManage && configuredProviders.size === 0 && GEMINI_FREE);
  // Offered until this person has a Google key of their own. A member who cannot manage the
  // team's keys sees it first: it is the one thing on this page they can do. Someone who can
  // sees it after the team's keys, and not at all while the team start card is on screen
  // asking for the same kind of key.
  const hasOwnGoogleKey = (payload.memberKeys ?? []).some((row) => row.provider === "google");
  const myFreeKey =
    !hasOwnGoogleKey && !showStart && !payload.setupRequired ? (
      <MyFreeGeminiKey
        busy={mineBusy}
        teamHasGoogleKey={configuredProviders.has("google")}
        onSave={saveMyGoogleKey}
      />
    ) : null;
  const savedModelText =
    routingDraft.mode === "fixed"
      ? formatModelList(routingDraft.fixedModelId ? [routingDraft.fixedModelId] : [], modelOptions)
      : formatModelList(
          routingDraft.enabledModelIds.filter((id) => !modelOptions.find((option) => option.id === id)?.fixedOnly),
          modelOptions,
        );
  const [modelText, setModelText] = useState(savedModelText);
  // The same choice as checkboxes (Pick for each job) or a menu (One model): nobody types names.
  const savedIds = routingDraft.mode === "fixed"
    ? (routingDraft.fixedModelId ? [routingDraft.fixedModelId] : [])
    : routingDraft.enabledModelIds.filter((id) => !modelOptions.find((option) => option.id === id)?.fixedOnly);
  const [pickedIds, setPickedIds] = useState<string[]>(savedIds);
  const pick = (ids: string[]) => {
    setPickedIds(ids);
    setModelText(formatModelList(ids, modelOptions));
    setModelError(null);
  };
  const [modelError, setModelError] = useState<string | null>(null);
  const [editingMine, setEditingMine] = useState<string | null>(null);
  const [mineEdit, setMineEdit] = useState({ label: "", model: "", apiKey: "" });
  const [mineEditError, setMineEditError] = useState<string | null>(null);
  const [mineEditBusy, setMineEditBusy] = useState(false);
  useEffect(() => {
    setModelText(savedModelText);
    setPickedIds(savedIds);
    setModelError(null);
    // savedIds is derived from the same draft as savedModelText.
  }, [savedModelText]);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    const id = focus === "yours" ? "settings-your-key" : focus === "team" ? "settings-team-keys" : "";
    if (!id) return;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  async function saveMineEdit(keyId: string) {
    if (!orgId || mineEditBusy) return;
    setMineEditBusy(true);
    setMineEditError(null);
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "update_key",
          keyId,
          scope: "member",
          label: mineEdit.label,
          model: mineEdit.model,
          ...(mineEdit.apiKey.trim() ? { apiKey: mineEdit.apiKey.trim() } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; notice?: string | null };
      if (!response.ok) {
        setMineEditError(data.error ?? "That change was not saved.");
        return;
      }
      setEditingMine(null);
      props.notify(data.notice ?? (mineEdit.apiKey.trim() ? "Key checked and saved." : "Saved."));
      await props.reload();
    } catch {
      setMineEditError("That change was not saved.");
    } finally {
      setMineEditBusy(false);
    }
  }
  return (
    <>
          {/* A credit gift from Vantage, when there is one: how much, how much is used. */}
          <AiCreditLine orgId={orgId} />
          {message ? (
            <p className={`ai-keys-flash${messageIsError ? " is-error" : ""}`} role={messageIsError ? "alert" : "status"}>
              {message}
            </p>
          ) : null}

          {!payload.canManage ? myFreeKey : null}

          {!payload.canManage ? (
            <ShellPanel
              shell="forbidden"
              detail="You can see configured / missing status. Ask an owner or admin with Manage API keys to paste or remove secrets."
              orgId={orgId}
            />
          ) : null}

          {/* One recommended path before any choice: most teams have no AI budget, and Gemini's
              free tier covers a team's chat, scouting summaries and strategy. */}
          {showStart && GEMINI_FREE ? (
            <section className="app-card soft-panel ai-keys-start" aria-labelledby="ai-keys-start-title">
              <span className="eyebrow">START HERE · FREE</span>
              <h2 id="ai-keys-start-title">Turn on AI with a free Google Gemini key</h2>
              <ol className="ai-keys-start-steps">
                <li>
                  Open{" "}
                  <a href={GEMINI_FREE.signupUrl} target="_blank" rel="noreferrer noopener">
                    Google AI Studio
                  </a>{" "}
                  and sign in with any Google account.
                </li>
                <li>Press Create API key and copy it.</li>
                <li>Paste it here and press Save. It takes about two minutes, and it costs nothing.</li>
              </ol>
              <form
                className="ai-keys-form ai-keys-start-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  save("google");
                }}
              >
                <label>
                  Gemini API key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={BYOK_PROVIDER_META.google.placeholder}
                    value={drafts.google ?? ""}
                    disabled={busyProvider === "google"}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, google: event.target.value }))}
                    required
                  />
                </label>
                {keyError?.provider === "google" ? (
                  <p className="ai-keys-field-error" role="alert">
                    {keyError.message}
                  </p>
                ) : null}
                <div className="ai-keys-actions">
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={busyProvider === "google" || !(drafts.google ?? "").trim()}
                  >
                    {busyProvider === "google" ? "Checking…" : "Check and save"}
                  </button>
                </div>
              </form>
              <p className="app-muted">
                Already pay for OpenAI, Anthropic or OpenRouter, or run a model in your shop? Open &ldquo;Use a different key&rdquo; below.
                Keys are encrypted and never shown again.
              </p>
            </section>
          ) : null}

          {/* With the free Gemini path on offer, the paid providers are the second choice and
              wait behind one line; once a team has a key they are simply the page. */}
          <details className="ai-keys-fold" id="settings-team-keys" open={!showStart}>
            <summary>
              <h2 className="ai-keys-fold-title">
                {showStart ? OTHER_KEYS_TITLE : "Your team's AI keys"}
              </h2>
            </summary>
          {orgId ? (
            <TeamKeyList
              orgId={orgId}
              keyList={payload.keyList}
              legacyStatuses={payload.keys}
              providers={providerMeta}
              canManage={payload.canManage}
              setupBlocked={Boolean(payload.setupRequired)}
              onChanged={props.reload}
              onMessage={props.notify}
              modelOptions={modelOptions}
            />
          ) : null}
          </details>

          {payload.canManage && modelOptions.length ? (
            <section className="app-card soft-panel ai-keys-routing" aria-label="Model routing">
              <h2>Which models to use</h2>
              <p className="app-muted">
                Choose from the models your team's keys can run.
              </p>
              <form
                className="ai-keys-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = matchModelList(modelText, modelOptions, routingDraft.mode);
                  if (parsed.unknown.length) {
                    setModelError(`We don't know ${parsed.unknown.join(", ")}.`);
                    return;
                  }
                  if (!modelTokens(modelText).length) {
                    setModelError(routingDraft.mode === "fixed" ? "Choose the model to use." : "Choose at least one model.");
                    return;
                  }
                  setModelError(null);
                  saveRouting(modelText);
                }}
              >
                <fieldset className="ai-keys-mode">
                  <legend>How to choose</legend>
                  <label className="check-field">
                    <input
                      type="radio"
                      name="byok-mode"
                      checked={routingDraft.mode === "fixed"}
                      onChange={() => setRoutingDraft((prev) => ({ ...prev, mode: "fixed" }))}
                    />{" "}
                    One model
                  </label>
                  <label className="check-field">
                    <input
                      type="radio"
                      name="byok-mode"
                      checked={routingDraft.mode === "automode"}
                      onChange={() => setRoutingDraft((prev) => ({ ...prev, mode: "automode" }))}
                    />{" "}
                    Pick for each job
                  </label>
                </fieldset>
                {routingDraft.mode === "fixed" ? (
                  <label>
                    Model
                    <select
                      value={pickedIds[0] ?? ""}
                      disabled={busyRouting}
                      aria-invalid={modelError ? true : undefined}
                      onChange={(event) => pick(event.target.value ? [event.target.value] : [])}
                    >
                      <option value="" disabled>Choose a model</option>
                      {modelOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    <small className="app-muted">Every AI feature uses this model.</small>
                  </label>
                ) : (
                  <fieldset className="ai-keys-model-checks">
                    <legend>Models it may pick from</legend>
                    {modelOptions.filter((option) => !option.fixedOnly).map((option) => (
                      <label key={option.id} className="check-field">
                        <input
                          type="checkbox"
                          checked={pickedIds.includes(option.id)}
                          disabled={busyRouting}
                          onChange={(event) =>
                            pick(event.target.checked ? [...pickedIds, option.id] : pickedIds.filter((id) => id !== option.id))
                          }
                        />{" "}
                        {option.label}
                      </label>
                    ))}
                    <small className="app-muted">A stronger model for CAD and code, a faster one for chat. Only from companies whose key you have added.</small>
                  </fieldset>
                )}
                {modelError ? <p className="ai-keys-field-error" role="alert">{modelError}</p> : null}
                <div className="ai-keys-actions">
                  <button className="primary-action" type="submit" disabled={busyRouting}>
                    {busyRouting ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {payload.canManage ? myFreeKey : null}

          {/* Web research sits with the keys a team brings, straight after the
              model providers: it is the other key that changes what the AI can do. */}
          {orgId ? (
            <details className="ai-keys-fold">
              <summary>
                <h2 className="ai-keys-fold-title">Let the AI search the web (optional, free)</h2>
              </summary>
              <WebResearchCard orgId={orgId} />
            </details>
          ) : null}

          {/* Personal keys and a personal model are for the few who want them. */}
          <details className="ai-keys-fold" id="settings-your-key" open={(payload.memberKeys ?? []).length > 0}>
            <summary>
              <h2 className="ai-keys-fold-title">Your keys and sharing</h2>
            </summary>
          <section className="app-card soft-panel ai-keys-mine" aria-label="My personal AI keys">
            <span className="eyebrow">MINE</span>
            <h2>{MEMBER_KEY_HEADLINE}</h2>
            <p className="app-muted">{MEMBER_KEY_BODY}</p>
            {(payload.memberKeys ?? []).length ? (
              <ul className="ai-keys-mine-list">
                {(payload.memberKeys ?? []).map((row) => (
                  <li key={row.id ?? row.provider}>
                    <div>
                      <strong>{row.label || BYOK_PROVIDER_META[row.provider as ByokProvider]?.label || row.provider}</strong>
                      {/* describeMemberKey never guesses: an unset base URL or
                          model is named as the inherited default, not invented. */}
                      <small className="app-muted">
                        {` ${describeMemberKey(row)}`}
                        {row.lastUsedAt
                          ? ` · last used ${new Date(row.lastUsedAt).toLocaleDateString()}`
                          : " · not used yet"}
                      </small>
                      {orgId && row.id ? (
                        <KeySpendMeter
                          orgId={orgId}
                          keyId={row.id}
                          scope="member"
                          label={row.label || BYOK_PROVIDER_META[row.provider as ByokProvider]?.label || row.provider}
                          spend={row}
                          canEdit
                          onSaved={props.reload}
                          onMessage={props.notify}
                        />
                      ) : null}
                    </div>
                    <span className="ai-keys-list-actions">
                      {row.id ? (
                        <Button
                          variant="secondary"
                          type="button"
                          disabled={mineBusy}
                          onClick={() => {
                            setEditingMine(row.id ?? null);
                            setMineEdit({ label: row.label || BYOK_PROVIDER_META[row.provider as ByokProvider]?.label || row.provider, model: row.model ?? "", apiKey: "" });
                            setMineEditError(null);
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <Button variant="secondary" type="button" disabled={mineBusy} onClick={async () => { if (await askConfirm({ title: "Remove your key?", body: "This personal key is deleted from Vantage. Any other key you saved stays.", confirmLabel: "Remove key", tone: "destructive" })) void removeMemberKey(row.provider, row.id); }}>
                        Remove
                      </Button>
                    </span>
                    {orgId && row.id ? <AiKeySharing orgId={orgId} row={row} ready={payload.sharingReady === true} members={payload.sharingMembers ?? []} onSaved={() => void props.reload()} /> : null}
                    {row.id && editingMine === row.id ? (
                      <form
                        className="ai-keys-edit"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveMineEdit(row.id!);
                        }}
                      >
                        <label>
                          Name
                          <input type="text" maxLength={60} value={mineEdit.label} onChange={(event) => setMineEdit((prev) => ({ ...prev, label: event.target.value }))} required />
                        </label>
                        <ModelSelect
                          provider={row.provider}
                          value={mineEdit.model}
                          options={modelOptions}
                          customEndpoint={Boolean(row.baseUrl)}
                          onChange={(model) => setMineEdit((prev) => ({ ...prev, model }))}
                        />
                        <label>
                          New API key
                          <input type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" spellCheck={false} value={mineEdit.apiKey} placeholder="Leave blank to keep the current key" onChange={(event) => setMineEdit((prev) => ({ ...prev, apiKey: event.target.value }))} />
                        </label>
                        {mineEditError ? <p className="ai-keys-field-error" role="alert">{mineEditError}</p> : null}
                        <div className="ai-keys-add-actions">
                          <Button variant="secondary" type="button" onClick={() => setEditingMine(null)}>Cancel</Button>
                          <Button variant="primary" type="submit" disabled={mineEditBusy || !mineEdit.label.trim()}>
                            {mineEditBusy ? (mineEdit.apiKey.trim() ? "Checking…" : "Saving…") : mineEdit.apiKey.trim() ? "Check and save" : "Save"}
                          </Button>
                        </div>
                      </form>
                    ) : null}
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
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
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
                <ModelSelect
                  provider={mineDraft.provider}
                  value={mineDraft.model}
                  options={modelOptions}
                  customEndpoint={Boolean(mineDraft.baseUrl.trim())}
                  onChange={(model) => setMineDraft((d) => ({ ...d, model }))}
                />
              ) : null}
              <Button variant="primary" type="submit" disabled={mineBusy || !mineDraft.apiKey.trim()}>
                {mineBusy ? "Checking…" : "Check and save"}
              </Button>
            </form>
          </section>

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
          </details>

          {/* The team's say over training on its AI activity: open, not folded (Privacy Policy). */}
          <AiTrainingCard orgId={orgId} />

          {/* Everything a team sets once, or never: how hosting is billed, any-endpoint
              notes, local models, free keys, routing and model policy. The walkthrough
              found the page ~5,500px tall with the key forms buried; they now come first. */}
          <details className="ai-keys-advanced ai-keys-fold">
            <summary>More options: free keys, your own model server, and which models people can pick</summary>
          <section className="app-card soft-panel ai-keys-billing" aria-label="Hosting vs your keys">
            <span className="eyebrow">{billing.title}</span>
            <p>{billing.body}</p>
            <p className="app-muted">
              See what the team&apos;s key has been used for on{" "}
              <a href={orgId ? withOrgHref("/team/usage", orgId) : "/team/usage"}>AI usage</a>.
            </p>
          </section>

          {/* The promise this page exists to make, stated before any of the
              provider-specific machinery below it: the endpoint is the team's
              choice, and the choice does not gate features. Copy lives in
              ./ai-keys-copy.ts so the promises stay pinned by tests. */}
          {/* For a team running its own model server: developer detail (endpoints, base URLs,
              tunnels), so it opens only when asked for. */}
          <details className="ai-keys-fold ai-keys-selfhost">
            <summary>Use a model you host yourself (Ollama, LM Studio, any OpenAI-style server)</summary>
          <section className="app-card soft-panel ai-keys-any" aria-label="Bring any OpenAI-compatible endpoint">
            <span className="eyebrow">BRING ANY ENDPOINT</span>
            <h2>{ANY_ENDPOINT_HEADLINE}</h2>
            <p className="app-muted">{ANY_ENDPOINT_BODY}</p>
            <ul className="ai-keys-any-points">
              {ANY_ENDPOINT_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>

          <section className="app-card soft-panel ai-keys-local" aria-label="Local OpenAI-compatible connector">
            <span className="eyebrow">LOCAL / OPENAI-COMPATIBLE</span>
            <h2>Ollama / LM Studio</h2>
            <p className="app-muted">
              Paste the address of your model server and the model to use. Vantage reaches it over
              the internet, so a laptop-only address (localhost) won&apos;t work: it needs an https
              address anyone can reach.
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
                    placeholder="https://my-model-server.example.org/v1"
                    value={localDraft.baseUrl}
                    disabled={busyLocal}
                    onChange={(e) => setLocalDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  />
                </label>
                <label>
                  Model name
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
          </details>

          {/* The start card is already the free path; this list is for a team without it. */}
          {!showStart && configuredProviders.size === 0 ? (
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
          ) : null}

          {freeSwarm?.enabled && freeSwarm.models.length && payload.canManage ? (
            <section className="app-card soft-panel ai-keys-free-swarm" aria-label="Free AI from volunteers">
              <h2>Free AI, from volunteers</h2>
              <p className="app-muted">
                When this team has no provider key, Vantage can ask the AI Horde. It costs nothing.
                It is slower than a paid key, and the volunteer running the model can read what you send,
                so Vantage never sends private notes to it.
              </p>
              <form
                className="ai-keys-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveRouting();
                }}
              >
                <label>
                  <input
                    type="radio"
                    name="free-swarm-model"
                    checked={!routingDraft.freeSwarmModel}
                    onChange={() => setRoutingDraft((prev) => ({ ...prev, freeSwarmModel: null }))}
                  />{" "}
                  <strong>Whichever is free</strong>
                </label>
                {freeSwarm.models.map((model) => (
                  <label key={model.id}>
                    <input
                      type="radio"
                      name="free-swarm-model"
                      checked={routingDraft.freeSwarmModel === model.id}
                      onChange={() => setRoutingDraft((prev) => ({ ...prev, freeSwarmModel: model.id }))}
                    />{" "}
                    <strong>{model.label}</strong>
                    <span className="app-muted"> · {model.note}</span>
                  </label>
                ))}
                <div className="ai-keys-actions">
                  <button className="primary-action" type="submit" disabled={busyRouting}>
                    Save
                  </button>
                </div>
              </form>
            </section>
          ) : null}

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
                          <strong title={opt.modelId}>{opt.label}</strong>
                          <span className="app-muted">
                            {" "}
                            · {opt.tierLabel}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}

                <div className="ai-keys-actions">
                  <button className="primary-action" type="submit" disabled={busyPolicy}>
                    Save policy
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          </details>
    </>
  );
}
