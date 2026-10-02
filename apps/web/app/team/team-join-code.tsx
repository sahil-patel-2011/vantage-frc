"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, ConfirmDialog, FormRow } from "../../components/ui";

export function TeamJoinCode({ orgId }: { orgId: string }) {
  const [code, setCode] = useState<{
      pin: string | null;
      enabled: boolean;
      teamNumber?: number;
    } | null>(null),
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
        throw new Error(data.error || "Could not load join code.");
      setCode(data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load join code.",
      );
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(enabled = true) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/organizations/join-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          ...(enabled ? { pin: pin || undefined } : { enabled: false }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update code.");
      setCode((current) => ({ ...current, ...data }));
      setEditing(false);
      setDisable(false);
      setPin("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save code.");
    } finally {
      setBusy(false);
    }
  }
  if (!code && !error) return null;
  return (
    <details className="team-code-panel">
      <summary>Join with a team code</summary>
      <p className="app-muted">
        Share the code with your team. People verify their email and join as
        team members.
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      ) : null}
      {code?.enabled && code.pin ? (
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
                setError(
                  "Could not copy. Select the code and copy it manually.",
                );
              }
            }}
          >
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setEditing((current) => !current)}
          >
            Change
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void save()}>
          {busy ? "Generating…" : "Generate join code"}
        </Button>
      )}
      {editing ? (
        <div className="team-code-edit">
          <FormRow label="New join code (optional)">
            <input
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              maxLength={6}
              placeholder="Generate one for me"
            />
          </FormRow>
          <p className="app-muted">
            The old code and pending code-based invitations will stop working.
            Current members stay on the team.
          </p>
          <Button
            variant="primary"
            disabled={busy || (pin.length > 0 && pin.length !== 6)}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save new code"}
          </Button>
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
            variant="ghost"
            disabled={busy}
            onClick={() => setDisable(true)}
          >
            Turn off code
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={disable}
        opts={{
          title: "Turn off the team join code?",
          body: "Code-based invitations that have not been accepted will stop working. Current members stay on the team.",
          confirmLabel: "Turn off code",
        }}
        onResolve={(confirmed) => {
          if (confirmed) void save(false);
          else setDisable(false);
        }}
      />
    </details>
  );
}
