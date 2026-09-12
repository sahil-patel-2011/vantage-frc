"use client";

import { Button } from "../../../components/ui";
import type { ByokKeyStatus } from "../../../lib/ai-keys/byok-providers";
import type { ProviderMeta } from "./ai-keys-model";

export function ProviderCard({
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
            <Button variant="primary" type="submit" disabled={busy || !draft.trim()}>
              {status.configured ? "Update & encrypt" : "Save & encrypt"}
            </Button>
            {status.configured ? (
              <Button variant="danger" type="button" disabled={busy} onClick={() => onRemove()}>
                Remove key
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </article>
  );
}
