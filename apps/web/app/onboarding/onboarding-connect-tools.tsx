"use client";

import { useEffect, useMemo, useState } from "react";
import { buildOnboardingLanding, type OnboardingDraft } from "../../lib/onboarding";
import {
  CONNECT_TOOL_PROVIDERS,
  buildConnectToolSaveRequest,
  connectToolTakesKey,
  memberKeyFor,
  savedKeyLabel,
  type ConnectToolProvider,
  type MemberKeyRow,
} from "../../lib/onboarding/connect-tools";
import { LandingPanel } from "./onboarding-landing";
import type { OnboardingState } from "./onboarding-model";
import "./onboarding-connect-tools.css";

type RowPhase = "idle" | "open" | "saving" | "saved" | "skipped";

type RowState = {
  phase: RowPhase;
  apiKey: string;
  error: string | null;
  /** Display-safe status from the key API — never the key. */
  saved: string | null;
};

type KeyStatus = {
  loaded: boolean;
  /** Encryption or migration missing on this server: keys cannot be stored. */
  setupMessage: string | null;
  canManageTeamKeys: boolean;
  tinyfish: { hint: string | null; verifiedAt: string | null } | null;
  memberKeys: MemberKeyRow[];
};

const EMPTY_ROW: RowState = { phase: "idle", apiKey: "", error: null, saved: null };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
}

/**
 * Finish screen for someone who is now on a team: an optional "Connect tools"
 * panel first, then the role-aware landing. Nothing here blocks — "Skip all"
 * finishes onboarding and opens Home.
 */
export function ConnectToolsThenLanding({ state, draft }: { state: OnboardingState; draft: OnboardingDraft }) {
  const [dismissed, setDismissed] = useState(false);
  const orgId = state.workspaceOrgId;
  if (!orgId || dismissed) return <LandingPanel state={state} draft={draft} />;
  return <ConnectToolsPanel orgId={orgId} state={state} draft={draft} onContinue={() => setDismissed(true)} />;
}

function ConnectToolsPanel({
  orgId,
  state,
  draft,
  onContinue,
}: {
  orgId: string;
  state: OnboardingState;
  draft: OnboardingDraft;
  onContinue: () => void;
}) {
  const [status, setStatus] = useState<KeyStatus>({
    loaded: false,
    setupMessage: null,
    canManageTeamKeys: false,
    tinyfish: null,
    memberKeys: [],
  });
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const homeHref = useMemo(
    () =>
      buildOnboardingLanding({
        teamRole: draft.teamRole,
        crewRole: draft.crewRole || null,
        roleDescription: draft.roleDescription || null,
        primaryFocus: draft.primaryFocus,
        orgId: state.workspaceOrgId,
        orgName: state.workspaceOrgName,
        platformAdmin: state.platformAdmin,
      }).primary.href,
    [draft, state],
  );

  useEffect(() => {
    let cancelled = false;
    const query = `?orgId=${encodeURIComponent(orgId)}`;
    void Promise.all([
      fetch(`/api/organizations/tool-keys${query}`, { cache: "no-store" }).then(async (r) => ({ ok: r.ok, data: await readJson(r) })),
      fetch(`/api/organizations/ai-keys${query}`, { cache: "no-store" }).then(async (r) => ({ ok: r.ok, data: await readJson(r) })),
    ])
      .then(([tools, ai]) => {
        if (cancelled) return;
        const tinyfish = (tools.data.tinyfish ?? null) as { configured?: boolean; hint?: string | null; verifiedAt?: string | null } | null;
        const setupMessage =
          (ai.data.setupRequired && typeof ai.data.setupMessage === "string" ? ai.data.setupMessage : null) ??
          (!ai.ok ? errorText(ai.data, "Keys cannot be saved on this server right now.") : null);
        setStatus({
          loaded: true,
          setupMessage,
          canManageTeamKeys: tools.ok && tools.data.canManage === true && !tools.data.setupRequired,
          tinyfish: tinyfish?.configured ? { hint: tinyfish.hint ?? null, verifiedAt: tinyfish.verifiedAt ?? null } : null,
          memberKeys: Array.isArray(ai.data.memberKeys) ? (ai.data.memberKeys as MemberKeyRow[]) : [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStatus((current) => ({
          ...current,
          loaded: true,
          setupMessage: "Could not reach the key settings. You can add keys later in Team settings.",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const rowOf = (id: string) => rows[id] ?? EMPTY_ROW;
  const update = (id: string, next: Partial<RowState>) =>
    setRows((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY_ROW), ...next } }));

  async function save(provider: ConnectToolProvider) {
    const row = rowOf(provider.id);
    const request = buildConnectToolSaveRequest(provider, orgId, row.apiKey);
    if (!request) return;
    if (!row.apiKey.trim()) {
      update(provider.id, { error: "Paste a key first, or skip this one." });
      return;
    }
    update(provider.id, { phase: "saving", error: null });
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const data = await readJson(response);
      if (!response.ok) {
        update(provider.id, { phase: "open", error: errorText(data, "Could not save that key.") });
        return;
      }
      // Clear the pasted key from memory as soon as the server has it.
      if (provider.storage.kind === "team-tool") {
        const tinyfish = (data.tinyfish ?? null) as { hint?: string | null } | null;
        update(provider.id, {
          phase: "saved",
          apiKey: "",
          saved: savedKeyLabel({ hint: tinyfish?.hint ?? null, verified: true }),
        });
      } else {
        update(provider.id, {
          phase: "saved",
          apiKey: "",
          saved: "Saved for your own requests. It is checked the first time Ask AI uses it. The key itself is never shown again.",
        });
        // A shared OpenAI-compatible slot: the other provider's saved state is now stale.
        setRows((current) => {
          const next = { ...current };
          for (const other of CONNECT_TOOL_PROVIDERS) {
            if (
              other.id !== provider.id &&
              other.storage.kind === "member-llm" &&
              provider.storage.kind === "member-llm" &&
              other.storage.provider === provider.storage.provider &&
              next[other.id]?.phase === "saved"
            ) {
              next[other.id] = { ...EMPTY_ROW };
            }
          }
          return next;
        });
        setStatus((current) => ({
          ...current,
          memberKeys: current.memberKeys.filter(
            (key) => provider.storage.kind !== "member-llm" || key.provider.toLowerCase() !== provider.storage.provider,
          ),
        }));
      }
    } catch {
      update(provider.id, { phase: "open", error: "Could not reach Vantage. Check your connection and try again." });
    }
  }

  function existingLabel(provider: ConnectToolProvider): string | null {
    if (provider.storage.kind === "team-tool" && status.tinyfish) {
      return savedKeyLabel({ hint: status.tinyfish.hint, verified: Boolean(status.tinyfish.verifiedAt) });
    }
    if (provider.storage.kind === "member-llm") {
      const row = memberKeyFor(provider, status.memberKeys);
      if (row) return savedKeyLabel({ hint: null });
    }
    return null;
  }

  return (
    <section className="onboarding-connect" aria-labelledby="onboarding-connect-title">
      <header className="onboarding-connect-head">
        <h2 id="onboarding-connect-title">Connect tools (optional)</h2>
        <p>
          Everything works without these. Each one switches on something extra. You can add or remove any of them later
          in Team settings → AI keys.
        </p>
      </header>

      {status.loaded && status.setupMessage ? (
        <p className="onboarding-connect-setup" role="status">
          {status.setupMessage}
        </p>
      ) : null}

      <ul className="onboarding-connect-list">
        {CONNECT_TOOL_PROVIDERS.map((provider) => {
          const row = rowOf(provider.id);
          const takesKey = connectToolTakesKey(provider);
          const existing = row.phase === "saved" ? row.saved : existingLabel(provider);
          const teamOnlyBlocked = provider.storage.kind === "team-tool" && status.loaded && !status.canManageTeamKeys;
          const canPaste = takesKey && status.loaded && !status.setupMessage && !teamOnlyBlocked;
          const inputId = `connect-${provider.id}-key`;
          return (
            <li key={provider.id} className={`onboarding-connect-row ${row.phase}`}>
              <div className="onboarding-connect-title">
                <strong>{provider.name}</strong>
                <span className={`onboarding-connect-cost${provider.cost === "Free" ? " free" : ""}`}>
                  {takesKey ? provider.cost : `${provider.cost} · Provided by Vantage`}
                </span>
              </div>
              <p className="onboarding-connect-unlocks">{provider.unlocks}</p>
              <p className="onboarding-connect-note">{provider.costNote}</p>
              {takesKey ? <p className="onboarding-connect-note">{provider.scopeNote}</p> : null}

              {existing ? (
                <p className="onboarding-connect-saved" role="status">
                  {existing}
                </p>
              ) : null}

              {takesKey && row.phase === "skipped" ? (
                <p className="onboarding-connect-skipped">{provider.skipConsequence}</p>
              ) : null}

              {teamOnlyBlocked && !existing && row.phase !== "skipped" ? (
                <p className="onboarding-connect-note">
                  A team owner or admin who manages API keys adds this one. {provider.skipConsequence.replace(/^Skip for now — /, "Until then, ")}
                </p>
              ) : null}

              {canPaste && (row.phase === "open" || row.phase === "saving") ? (
                <form
                  className="onboarding-connect-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(provider);
                  }}
                >
                  <label htmlFor={inputId}>{provider.name} API key</label>
                  <input
                    id={inputId}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={provider.placeholder}
                    value={row.apiKey}
                    disabled={row.phase === "saving"}
                    aria-invalid={row.error ? true : undefined}
                    aria-describedby={row.error ? `${inputId}-error` : undefined}
                    onChange={(event) => update(provider.id, { apiKey: event.target.value, error: null })}
                  />
                  {provider.keyPageUrl ? (
                    <a href={provider.keyPageUrl} target="_blank" rel="noopener noreferrer">
                      Get a {provider.name} key
                    </a>
                  ) : null}
                  {row.error ? (
                    <p className="onboarding-connect-error" id={`${inputId}-error`} role="alert">
                      {row.error}
                    </p>
                  ) : null}
                  <div className="onboarding-connect-actions">
                    <button type="submit" className="signin-submit" disabled={row.phase === "saving"}>
                      {row.phase === "saving" ? "Saving…" : "Save key"}
                    </button>
                    <button
                      type="button"
                      className="signin-link"
                      disabled={row.phase === "saving"}
                      onClick={() => update(provider.id, { phase: "skipped", apiKey: "", error: null })}
                    >
                      Skip for now
                    </button>
                  </div>
                </form>
              ) : null}

              {takesKey && row.phase !== "open" && row.phase !== "saving" && row.phase !== "skipped" ? (
                <div className="onboarding-connect-actions">
                  {canPaste ? (
                    <button type="button" className="signin-link" onClick={() => update(provider.id, { phase: "open" })}>
                      {existing ? "Replace key" : "Add key"}
                    </button>
                  ) : null}
                  {!existing ? (
                    <button
                      type="button"
                      className="signin-link"
                      title={provider.skipConsequence}
                      onClick={() => update(provider.id, { phase: "skipped", apiKey: "", error: null })}
                    >
                      Skip for now
                    </button>
                  ) : null}
                </div>
              ) : null}
              {takesKey && !existing && !teamOnlyBlocked && row.phase === "idle" ? (
                <p className="onboarding-connect-consequence">{provider.skipConsequence}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="onboarding-pending-actions">
        <button type="button" className="signin-submit" onClick={onContinue}>
          Continue
        </button>
        <a className="signin-link" href={homeHref}>
          Skip all
        </a>
      </div>
    </section>
  );
}
