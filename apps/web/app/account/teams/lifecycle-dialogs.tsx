"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, Modal } from "../../../components/ui";
import { forgetOfflineIdentity } from "../../../lib/offline/identity";
import { clearFeatureSnapshotsOnSignOut } from "../../../lib/offline/feature-cache";
import { signOutAndRedirect } from "../../../lib/sign-out";
import { withOrgHref } from "../../../lib/nav/product-nav";
import {
  ACCOUNT_DELETION_KEEPS,
  ACCOUNT_DELETION_REMOVES,
  TEAM_DELETION_KEEPS,
  TEAM_DELETION_REMOVES,
  teamConfirmPhrase,
  teamDisplayName,
  type LifecycleRefusal,
} from "../../../lib/team-lifecycle/model";
import "./team-lifecycle.css";

type Outcome = { ok: true; next?: string } | { ok: false; error: string; reason?: LifecycleRefusal };

async function send(url: string, method: string, body: unknown, fallback: string): Promise<Outcome> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; reason?: LifecycleRefusal; next?: string };
    if (!response.ok) return { ok: false, error: data.error ?? fallback, reason: data.reason };
    return { ok: true, next: data.next };
  } catch {
    return { ok: false, error: `${fallback} Check your connection.` };
  }
}

/**
 * The one shape for a delete you can't undo: what goes, what stays, and a phrase to type before
 * the red button wakes up. Cancel is on the left and has focus first; Enter never deletes.
 */
function TypedDeleteDialog({
  title,
  intro,
  removes,
  keeps,
  before,
  phraseLabel,
  phrase,
  matches,
  confirmLabel,
  busy,
  error,
  reauth,
  done,
  onConfirm,
  onClose,
}: {
  title: string;
  intro: string;
  removes: readonly string[];
  keeps: string;
  before?: ReactNode;
  phraseLabel: ReactNode;
  phrase: string;
  matches: (typed: string) => boolean;
  confirmLabel: string;
  busy: boolean;
  error: string;
  reauth: boolean;
  done?: string;
  onConfirm: (typed: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const ready = matches(typed) && !busy && !done;
  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={title} hideClose>
      <div className="lifecycle-dialog">
        {done ? (
          <p role="status" className="lifecycle-done">{done}</p>
        ) : (
          <>
            <p>{intro}</p>
            <div className="lifecycle-dialog-lists">
              <div>
                <strong>Removed for good</strong>
                <ul>
                  {removes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <p className="lifecycle-keeps">{keeps}</p>
            </div>
            {before}
            <label className="lifecycle-phrase" htmlFor={inputId}>
              {phraseLabel}
              <input
                id={inputId}
                value={typed}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={phrase}
                disabled={busy}
                onChange={(event) => setTyped(event.target.value)}
                // Deleting takes a deliberate tap on the red button, never Enter.
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
            </label>
            {error ? (
              <p role="alert" className="lifecycle-error">
                {error}
                {reauth ? (
                  <>
                    {" "}
                    <button type="button" className="text-button" onClick={() => void signOutAndRedirect(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)}>
                      Sign out and sign in again
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        )}
        <div className="lifecycle-dialog-actions">
          <Button type="button" variant="secondary" disabled={busy || Boolean(done)} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={!ready} onClick={() => onConfirm(typed)}>
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export type DeletableTeam = {
  orgId: string;
  name: string;
  teamNumber: number | null;
  memberCount: number;
  paidPlan: boolean;
};

/** Delete a team: owner only, the team number typed to confirm, with an export offered first. */
export function TeamDeleteDialog({ team, onClose }: { team: DeletableTeam; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<LifecycleRefusal | undefined>();
  const [done, setDone] = useState("");
  const label = teamDisplayName(team);
  const phrase = teamConfirmPhrase(team);
  const others = Math.max(0, team.memberCount - 1);

  async function confirm(typed: string) {
    setBusy(true);
    setError("");
    const outcome = await send("/api/organizations/lifecycle", "DELETE", { orgId: team.orgId, confirm: typed.trim() },
      "The team wasn't deleted.");
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      setReason(outcome.reason);
      return;
    }
    setDone(`${label} is deleted. Taking you to your teams…`);
    window.setTimeout(() => window.location.assign(outcome.next ?? "/account/teams"), 1200);
  }

  return (
    <TypedDeleteDialog
      title={`Delete ${label}?`}
      intro={`This deletes the team for ${others ? `you and the ${others} other ${others === 1 ? "person" : "people"} on it` : "you"}, right away. It can't be undone.`}
      removes={TEAM_DELETION_REMOVES}
      keeps={TEAM_DELETION_KEEPS}
      before={
        team.paidPlan ? (
          <p className="lifecycle-error">This team still has a paid plan. Cancel it in Billing first, then come back.</p>
        ) : (
          <p className="lifecycle-export">
            Want a copy? <a href={withOrgHref("/exports", team.orgId)}>Download your team&rsquo;s data</a> first. After this, it&rsquo;s gone.
          </p>
        )
      }
      phraseLabel={<>Type <strong>{phrase}</strong> to confirm</>}
      phrase={phrase}
      matches={(typed) => !team.paidPlan && typed.trim() === phrase}
      confirmLabel="Delete team"
      busy={busy}
      error={error}
      reauth={reason === "reauth_required"}
      done={done || undefined}
      onConfirm={(typed) => void confirm(typed)}
      onClose={onClose}
    />
  );
}

/** Delete my account: the person's email typed to confirm. */
export function AccountDeleteDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<LifecycleRefusal | undefined>();
  const [done, setDone] = useState("");

  async function confirm(typed: string) {
    setBusy(true);
    setError("");
    const outcome = await send("/api/account/delete", "POST", { confirm: typed.trim() }, "Your account wasn't deleted.");
    if (!outcome.ok) {
      setBusy(false);
      setError(outcome.error);
      setReason(outcome.reason);
      return;
    }
    // The same tidy-up as signing out: nothing of this account stays on the device.
    forgetOfflineIdentity();
    await Promise.allSettled([
      clearFeatureSnapshotsOnSignOut(),
      typeof caches === "undefined"
        ? Promise.resolve()
        : caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("vantage-shell-")).map((key) => caches.delete(key)))),
    ]);
    setBusy(false);
    setDone("Your account is deleted. Taking you to the Vantage home page…");
    window.setTimeout(() => window.location.assign(outcome.next ?? "/"), 1500);
  }

  return (
    <TypedDeleteDialog
      title="Delete your account?"
      intro="You'll be signed out everywhere and can't sign in to this account again. It can't be undone."
      removes={ACCOUNT_DELETION_REMOVES}
      keeps={ACCOUNT_DELETION_KEEPS}
      phraseLabel={<>Type your email, <strong>{email}</strong>, to confirm</>}
      phrase={email}
      matches={(typed) => typed.trim().toLowerCase() === email.trim().toLowerCase()}
      confirmLabel="Delete my account"
      busy={busy}
      error={error}
      reauth={reason === "reauth_required"}
      done={done || undefined}
      onConfirm={(typed) => void confirm(typed)}
      onClose={onClose}
    />
  );
}
