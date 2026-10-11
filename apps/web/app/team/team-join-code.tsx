"use client";
import { useCallback, useEffect, useState } from "react";
import { ROLE_HINTS, ROLE_LABELS } from "@vantage/core/role-words";
import { Button, ConfirmDialog, FormRow } from "../../components/ui";
import { joinCodeAccessSentence, joinCodeDigits } from "../../lib/team/join-code-flow";

type JoinRole = "scout" | "viewer";
type CodeState = { pin: string | null; enabled: boolean; joinRole?: JoinRole; teamNumber?: number };

/**
 * The team join code. It used to be on for every new team, inside a closed "Share the team
 * join code" disclosure, and gave every joiner Student access with nobody choosing (QA A3-01):
 * now it says plainly whether it is on, it starts off, and the owner picks what joiners get.
 */
export function TeamJoinCode({ orgId }: { orgId: string }) {
  const [code, setCode] = useState<CodeState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [editing, setEditing] = useState(false),
    [pin, setPin] = useState(""),
    [disable, setDisable] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        `/api/organizations/join-code?orgId=${encodeURIComponent(orgId)}`,
      );
      if (response.status === 403) return;
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not load the join code.");
      setCode(data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load the join code.",
      );
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/organizations/join-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn't save. Try again.");
      setCode((current) => ({ ...(current ?? { pin: null, enabled: false }), ...data }));
      setEditing(false);
      setDisable(false);
      setPin("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const helpId = `team-code-help-${orgId}`;
  if (!code && !error) return null;
  const joinRole: JoinRole = code?.joinRole === "scout" ? "scout" : "viewer";
  const on = Boolean(code?.enabled && code.pin);
  return (
    <section className="team-code-panel" aria-labelledby={`team-code-title-${orgId}`}>
      <div className="team-code-head">
        <h2 id={`team-code-title-${orgId}`}>Team join code</h2>
        <span className={`team-code-state${on ? " is-on" : ""}`}>{on ? "On" : "Off"}</span>
      </div>
      <p className="app-muted" id={helpId}>
        {joinCodeAccessSentence({ enabled: on, joinRole, teamNumber: code?.teamNumber })}
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      ) : null}

      {code ? (
        <fieldset className="team-code-role" disabled={busy}>
          <legend>People who join with the code get</legend>
          {(["viewer", "scout"] as const).map((role) => (
            <label key={role}>
              <input
                type="radio"
                name={`team-code-role-${orgId}`}
                checked={joinRole === role}
                onChange={() => void post({ role })}
              />
              <span>
                <strong>
                  {ROLE_LABELS[role]}
                  {role === "viewer" ? " (safest: you give students Student access)" : ""}
                </strong>
                <small className="app-muted">{ROLE_HINTS[role]}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {on && code?.pin ? (
        <div className="team-code-row">
          <output aria-label="Team join code">{code.pin}</output>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setError("");
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/join-team\nTeam ${code.teamNumber ?? ""}\nTeam join code: ${code.pin}`,
                );
                setCopied(true);
              } catch {
                setError("Could not copy. Select the code and copy it yourself.");
              }
            }}
          >
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing((current) => !current)}>
            New code
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDisable(true)}>
            Turn off
          </Button>
        </div>
      ) : code ? (
        <div className="team-code-actions">
          <Button
            variant="secondary"
            disabled={busy}
            aria-describedby={helpId}
            aria-busy={busy || undefined}
            onClick={() => void post({ enabled: true })}
          >
            {busy ? "Turning on…" : "Turn on join code"}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <div className="team-code-edit">
          <FormRow label="New join code (optional)">
            {/* No maxLength: a pasted "123 456" keeps all six digits. */}
            <input
              value={pin}
              onChange={(event) => setPin(joinCodeDigits(event.target.value))}
              inputMode="numeric"
              placeholder="Make one for me"
            />
          </FormRow>
          <p className="app-muted">
            The old code stops working, and so do code invites nobody has used yet. People already on the
            team stay on it.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setPin("");
              setError("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || (pin.length > 0 && pin.length !== 6)}
            onClick={() => void post({ pin: pin || undefined })}
          >
            {busy ? "Saving…" : "Save new code"}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={disable}
        opts={{
          title: "Turn off the team join code?",
          body: "Nobody can join with it until you turn it on again. Code invites nobody has used yet stop working. People already on the team stay on it.",
          confirmLabel: "Turn off code",
          tone: "destructive",
        }}
        onResolve={(confirmed) => {
          if (confirmed) void post({ enabled: false });
          else setDisable(false);
        }}
      />
    </section>
  );
}
