"use client";

import { useState } from "react";
import { BYOK_PROVIDER_META } from "../../../lib/ai-keys/byok-providers";
import { FREE_KEY_PROVIDERS } from "../../../lib/ai-keys/free-key-providers";
import {
  MY_FREE_KEY_BODY,
  MY_FREE_KEY_HEADLINE,
  MY_FREE_KEY_SCHOOL_NOTE,
  MY_FREE_KEY_TEAM_BACKUP,
} from "./ai-keys-copy";

const GEMINI_FREE = FREE_KEY_PROVIDERS.find((provider) => provider.byokProvider === "google") ?? null;

/**
 * One field for any member's own free Gemini key.
 *
 * The personal-key form sat in a closed fold behind a provider picker, a base URL and a
 * model id, which is the right form for someone running their own model server and the
 * wrong one for a student with a key to paste. Google counts its free allowance per
 * account, so each person who adds a key here adds capacity instead of sharing the team's.
 */
export function MyFreeGeminiKey({
  busy,
  teamHasGoogleKey,
  onSave,
}: {
  busy: boolean;
  teamHasGoogleKey: boolean;
  onSave: (apiKey: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  if (!GEMINI_FREE) return null;
  return (
    <section className="app-card soft-panel ai-keys-start" aria-labelledby="ai-keys-mine-free-title">
      <span className="eyebrow">JUST FOR YOU · FREE</span>
      <h2 id="ai-keys-mine-free-title">{MY_FREE_KEY_HEADLINE}</h2>
      <p className="app-muted">
        {MY_FREE_KEY_BODY}
        {teamHasGoogleKey ? ` ${MY_FREE_KEY_TEAM_BACKUP}` : ""}
      </p>
      <ol className="ai-keys-start-steps">
        <li>
          Open{" "}
          <a href={GEMINI_FREE.signupUrl} target="_blank" rel="noreferrer noopener">
            Google AI Studio
          </a>{" "}
          and sign in. {MY_FREE_KEY_SCHOOL_NOTE}
        </li>
        <li>Press Create API key and copy it.</li>
        <li>Paste it here and press Save my key.</li>
      </ol>
      <form
        className="ai-keys-form ai-keys-start-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft).then((saved) => {
            if (saved) setDraft("");
          });
        }}
      >
        <label>
          Your Gemini API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={BYOK_PROVIDER_META.google.placeholder}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            required
          />
        </label>
        <div className="ai-keys-actions">
          <button className="primary-action" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Saving…" : "Save my key"}
          </button>
        </div>
      </form>
    </section>
  );
}
