"use client";

/**
 * Message settings: the org's direct-message policy, plus the audited DM export.
 *
 * Kept in its own file so the hot messages client stays small. Everything here is a thin shell
 * over `/api/messages/policy` and `/api/messages/export` — the rule itself is enforced in the
 * database and the API (migration 0455_chat_youth_protection), never here. See
 * The DM policy is enforced at conversation creation and on every send.
 */

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import { DM_MODES, type DmMode } from "../../lib/messages/youth-protection";

type ModeCopy = { label: string; detail: string };

type PolicyPayload = {
  supported: boolean;
  dmMode: DmMode;
  canManage: boolean;
  viewerClass: "adult" | "youth";
  updatedAt: string | null;
  updatedByName: string | null;
  adultAdmins: { userId: string; name: string; memberRole: string }[];
  modes: Record<DmMode, ModeCopy>;
  setupMessage: string | null;
};

type Member = { id: string; name: string; email: string; role: string };

function formatWhen(value: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export default function ChatSafetyPanel({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState<PolicyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<DmMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [members, setMembers] = useState<Member[]>([]);
  const [exportMemberId, setExportMemberId] = useState("");
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const [exportReason, setExportReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/messages/policy?orgId=${encodeURIComponent(orgId)}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Could not load chat safety settings.");
        return;
      }
      setPolicy(data as PolicyPayload);
      setChoice((data as PolicyPayload).dmMode);
    } catch {
      setError("Could not load chat safety settings.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only an owner/admin can export, so only they need the member roster.
  useEffect(() => {
    if (!policy?.canManage || !policy.supported || members.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/messages?orgId=${encodeURIComponent(orgId)}&mode=members`,
        );
        const data = await response.json();
        if (!cancelled && response.ok) setMembers((data.members ?? []) as Member[]);
      } catch {
        /* the export form shows its own empty state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [members.length, orgId, policy?.canManage, policy?.supported]);

  async function saveMode() {
    if (!choice || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/messages/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, dmMode: choice }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not save the chat safety setting.");
        return;
      }
      setPolicy(data as PolicyPayload);
      setChoice((data as PolicyPayload).dmMode);
      setStatus("Saved. New private chats follow this rule immediately.");
    } catch {
      setStatus("Could not save the chat safety setting.");
    } finally {
      setSaving(false);
    }
  }

  async function runExport() {
    if (exporting) return;
    if (!exportMemberId) {
      setExportStatus("Choose a member to export.");
      return;
    }
    setExporting(true);
    setExportStatus("");
    try {
      const response = await fetch("/api/messages/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          memberUserId: exportMemberId,
          format: exportFormat,
          reason: exportReason,
        }),
      });
      if (!response.ok) {
        let message = "Export failed.";
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {
          /* non-JSON error body */
        }
        setExportStatus(message);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] ?? `dm-history.${exportFormat}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportReason("");
      setExportStatus("Exported. This export is recorded in the team's audit log.");
    } catch {
      setExportStatus("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="chat-safety-panel">
        <EmptyState soft title="Loading chat safety…" aria-busy />
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="chat-safety-panel">
        <EmptyState
          title="Message settings unavailable"
          description={error ?? "Could not load chat safety settings."}
          badge="Unavailable"
          badgeTone="setup"
        >
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Retry
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (!policy.supported) {
    return (
      <div className="chat-safety-panel">
        <header>
          <h2>Message settings</h2>
          <p>{policy.setupMessage}</p>
        </header>
        <p className="chat-safety-warning">
          Until that migration runs, private messages between an adult and a student are not
          supervised and cannot be exported.
        </p>
      </div>
    );
  }

  const modes = (DM_MODES as readonly DmMode[]).filter((mode) => policy.modes[mode]);
  const selected = choice ?? policy.dmMode;
  const noSecondAdult = policy.adultAdmins.length < 2;

  return (
    <div className="chat-safety-panel">
      <header>
        <h2>Message settings</h2>
        <p>
          How private messages between an adult (mentor, coach, or parent) and a student are
          handled on this team. Student–student and adult–adult chats are never affected. Adult or
          student is read from the team role each person chose at onboarding — it is a role, not a
          verified age.
        </p>
        {policy.updatedAt ? (
          <p>
            Last changed {formatWhen(policy.updatedAt)}
            {policy.updatedByName ? ` by ${policy.updatedByName}` : ""}.
          </p>
        ) : (
          <p>Never changed — this team is on the default, second adult required.</p>
        )}
      </header>

      <div className="chat-safety-modes" role="radiogroup" aria-label="Adult–student private chat policy">
        {modes.map((mode) => (
          <label
            key={mode}
            className={`chat-safety-mode${selected === mode ? " active" : ""}`}
          >
            <input
              type="radio"
              name="dm-mode"
              value={mode}
              checked={selected === mode}
              disabled={!policy.canManage || saving}
              onChange={() => setChoice(mode)}
            />
            <span>
              <strong>{policy.modes[mode].label}</strong>
              <small>{policy.modes[mode].detail}</small>
            </span>
          </label>
        ))}
      </div>

      {selected === "open" ? (
        <p className="chat-safety-warning">
          Open DMs remove the second-adult rule entirely, including between an adult and a student.
          Many school districts prohibit exactly this configuration. Owners and admins can still
          export a member&rsquo;s history, and every export is logged, but nobody is in the room.
        </p>
      ) : null}

      {selected === "supervised" && noSecondAdult ? (
        <p className="chat-safety-warning">
          This team has {policy.adultAdmins.length === 1 ? "only one" : "no"} adult owner or admin,
          so there is nobody to be the second adult. Adult–student private chats will be refused
          until another mentor, coach, or parent is made an owner or admin.
        </p>
      ) : null}

      {policy.canManage ? (
        <div className="chat-export-actions">
          <Button variant="primary" type="button" onClick={() => void saveMode()} disabled={saving || selected === policy.dmMode}>
            {saving ? "Saving…" : "Save policy"}
          </Button>
          {status ? (
            <p className="chat-safety-note" role="status">
              {status}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="chat-safety-note">
          Only an owner or admin can change this. You are shown the rule because it applies to your
          own conversations.
        </p>
      )}

      {policy.canManage ? (
        <div className="chat-export-form">
          <p className="chat-safety-note">
            Child-safety export: retrieve one member&rsquo;s private message history. This is for
            responding to a safeguarding concern, not routine monitoring. A written reason is
            required, and every export is recorded in the team&rsquo;s audit log. Messages the
            sender deleted are included, with the time they were deleted.
          </p>
          <label>
            Member
            <select
              value={exportMemberId}
              onChange={(event) => setExportMemberId(event.target.value)}
            >
              <option value="">Choose a member…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason (recorded in the audit log)
            <textarea
              value={exportReason}
              onChange={(event) => setExportReason(event.target.value)}
              placeholder="e.g. Safeguarding review requested by the school on 12 March."
              maxLength={500}
            />
          </label>
          <label>
            Format
            <select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value === "csv" ? "csv" : "json")}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <div className="chat-export-actions">
            <Button variant="secondary" type="button" onClick={() => void runExport()} disabled={exporting}>
              {exporting ? "Exporting…" : "Export message history"}
            </Button>
          </div>
          {exportStatus ? (
            <p className="chat-safety-note" role="status">
              {exportStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
