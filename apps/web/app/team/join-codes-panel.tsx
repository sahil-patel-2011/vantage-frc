"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { joinCodeLimits, joinCodeState } from "../../lib/team/join-codes";

/**
 * Self-signup codes for owners/admins. The redeem side (/join) and the management API
 * both already existed; without this panel a code could be redeemed but never created,
 * so the feature was unreachable from the product.
 *
 * A code only ever grants scout or viewer — migration 0515 enforces that with a CHECK,
 * so a leaked code cannot escalate into control of a workspace. That is worth saying
 * out loud in the UI, because "anyone with this link can join" invites the question.
 */
type JoinCode = {
  id: string;
  code: string;
  role: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  redemptions: number;
};

type Notice = { tone: "info" | "error"; message: string };

export function JoinCodesPanel({ orgId }: { orgId: string }) {
  const [codes, setCodes] = useState<JoinCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState("scout");
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const response = await fetch(`/api/team/join-codes?orgId=${encodeURIComponent(orgId)}`);
      const data = (await response.json()) as { codes?: JoinCode[]; error?: string };
      if (!response.ok) {
        // 403 here is the normal experience for a scout, not a failure worth shouting about.
        if (response.status !== 403) {
          setNotice({ tone: "error", message: data.error ?? "Could not load join codes" });
        }
        setLoaded(true);
        return;
      }
      setCodes(data.codes ?? []);
    } catch {
      setNotice({ tone: "error", message: "Could not reach the server" });
    } finally {
      setLoaded(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const parsedUses = maxUses.trim() ? Number(maxUses) : null;
      const parsedDays = expiresInDays.trim() ? Number(expiresInDays) : 0;
      const response = await fetch(`/api/team/join-codes?orgId=${encodeURIComponent(orgId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, maxUses: parsedUses, expiresInDays: parsedDays }),
      });
      const data = (await response.json()) as { code?: string; error?: string };
      if (!response.ok) {
        setNotice({ tone: "error", message: data.error ?? "Could not create a join code" });
        return;
      }
      setNotice({ tone: "info", message: `Code ${data.code} is live. Share it with your team.` });
      await load();
    } catch {
      setNotice({ tone: "error", message: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/team/join-codes?orgId=${encodeURIComponent(orgId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice({ tone: "error", message: data.error ?? "Could not turn that code off" });
        return;
      }
      await load();
    } catch {
      setNotice({ tone: "error", message: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(code: string) {
    const link = `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setNotice({ tone: "error", message: `Copy failed. The link is ${link}` });
    }
  }

  return (
    <section className="admin-grid team-join-code-grid" id="join-codes">
      <form className="team-invite-form" onSubmit={createCode}>
        <span className="eyebrow">SELF-SIGNUP</span>
        <h2>Let teammates join with a code</h2>
        <p>
          Anyone who signs in and enters a live code joins this team immediately, with no
          invite needed. A code can only grant scout or viewer — owner and admin stay
          invite-only.
        </p>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="scout">Scout</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <label>
          Max uses
          <input
            type="number"
            min={1}
            max={500}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            placeholder="Leave blank for unlimited"
          />
        </label>
        <label>
          Expires in days
          <input
            type="number"
            min={0}
            max={365}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            placeholder="0 for no expiry"
          />
        </label>
        <button className="primary-action" type="submit" disabled={busy}>
          {busy ? "Working…" : "Create join code"}
        </button>
        {notice ? (
          <p className={`team-invite-notice ${notice.tone}`} role="status">
            {notice.message}
          </p>
        ) : null}
      </form>

      <Panel className="invite-list team-join-code-list">
        <span className="eyebrow">Codes</span>
        {!loaded ? (
          <p className="app-muted">Loading…</p>
        ) : !codes.length ? (
          <EmptyState
            soft
            badge="No codes yet"
            badgeTone="setup"
            title="No join codes"
            description="Create one on the left to let teammates add themselves without an invite."
          />
        ) : (
          <ul className="team-join-code-rows">
            {codes.map((code) => {
              const state = joinCodeState(code);
              return (
                <li key={code.id} className={`team-join-code-row ${state.tone}`}>
                  <div className="team-join-code-head">
                    <code>{code.code}</code>
                    <span className={`team-join-code-state ${state.tone}`}>{state.label}</span>
                  </div>
                  <span className="app-muted">
                    {code.role} · {joinCodeLimits(code)}
                  </span>
                  <div className="team-join-code-actions">
                    <button type="button" onClick={() => void copyLink(code.code)}>
                      {copied === code.code ? "Copied" : "Copy link"}
                    </button>
                    {state.tone === "live" ? (
                      <button type="button" disabled={busy} onClick={() => void revoke(code.id)}>
                        Turn off
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}
