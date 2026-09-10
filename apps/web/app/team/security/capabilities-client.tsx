"use client";

import { useEffect, useState } from "react";
import { EmptyState, Panel, Button } from "../../../components/ui";

type OrgCapability =
  | "manage_api_keys"
  | "manage_team_settings"
  | "manage_members"
  | "manage_billing";

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  capabilities: OrgCapability[];
  joinedAt: string;
};

type AdminTenure = {
  inviteHint: string | null;
  lastAdminLocked: boolean;
  bootstrapActive: boolean;
};

const LABELS: Record<OrgCapability, { title: string; hint: string }> = {
  manage_api_keys: {
    title: "Manage API keys / connectors",
    hint: "Your AI keys, TBA, and Chat limits",
  },
  manage_team_settings: {
    title: "Manage team settings",
    hint: "Auth policy and org preference toggles",
  },
  manage_members: {
    title: "Manage members / invites",
    hint: "Send and revoke invites",
  },
  manage_billing: {
    title: "Manage billing",
    hint: "Checkout / portal — owner grant only",
  },
};

const ALL_CAPS = Object.keys(LABELS) as OrgCapability[];

export default function CapabilitiesClient({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [adminTenure, setAdminTenure] = useState<AdminTenure | null>(null);
  const [drafts, setDrafts] = useState<Record<string, OrgCapability[]>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/organizations/members?orgId=${orgId}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Unable to load members");
      setLoading(false);
      return;
    }
    setMembers(data.members ?? []);
    setActorRole(data.actorRole ?? null);
    setAdminTenure((data.adminTenure as AdminTenure | undefined) ?? null);
    const next: Record<string, OrgCapability[]> = {};
    for (const member of data.members ?? []) {
      next[member.userId] = [...(member.capabilities ?? [])];
    }
    setDrafts(next);
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function saveCapabilities(userId: string) {
    const response = await fetch("/api/organizations/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        userId,
        action: "set_capabilities",
        capabilities: drafts[userId] ?? [],
      }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Capabilities updated and audited." : data.error);
    if (response.ok) await load();
  }

  async function promoteAdmin(userId: string) {
    if (!confirm("Promote this member to team admin? They will receive full admin powers.")) return;
    const response = await fetch("/api/organizations/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, userId, action: "set_role", role: "admin" }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Member promoted to team admin." : data.error);
    if (response.ok) await load();
  }

  async function demote(userId: string, role: "scout" | "viewer") {
    const response = await fetch("/api/organizations/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, userId, action: "set_role", role }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Role set to ${role}.` : data.error);
    if (response.ok) await load();
  }

  function toggle(userId: string, capability: OrgCapability) {
    if (capability === "manage_billing" && actorRole !== "owner") return;
    setDrafts((prev) => {
      const current = prev[userId] ?? [];
      const next = current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability];
      return { ...prev, [userId]: next };
    });
  }

  const editable = members.filter((member) => member.role === "scout" || member.role === "viewer");
  const admins = members.filter((member) => member.role === "owner" || member.role === "admin");

  return (
    <Panel className="member-capabilities-panel">
      <span className="eyebrow">Delegated admin powers</span>
      <h2>Member capabilities</h2>
      <p className="app-muted">
        Grant elevated capabilities to scouts and viewers without promoting them to full team admin. Includes API keys /
        connectors and budgets. Changes are enforced on API routes and audited.
      </p>
      {adminTenure?.inviteHint ? (
        <p className="app-muted" role="note">
          {adminTenure.inviteHint}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}
      {loading ? (
        <EmptyState soft title="Loading members…" description="Pulling roles and delegated capabilities." aria-busy />
      ) : (
        <>
          <div className="invite-list" style={{ marginBottom: "1rem" }}>
            {admins.map((member) => (
              <article key={member.userId}>
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.email} · {member.role} · full admin powers
                  </small>
                </div>
                {member.role === "admin" && actorRole === "owner" ? (
                  <div>
                    <button type="button" onClick={() => void demote(member.userId, "scout")}>
                      Demote to scout
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {!editable.length ? (
            <EmptyState
              soft
              title="No scouts or viewers to delegate"
              description="Invite members from Team admin, then grant API keys, budgets, or settings powers here."
            >
              <Button as="a" variant="secondary" href={`/team?orgId=${orgId}`}>
                Open Team admin
              </Button>
            </EmptyState>
          ) : null}
          {editable.map((member) => (
            <article className="admin-org" key={member.userId} style={{ marginBottom: "1rem" }}>
              <div>
                <strong>{member.name}</strong>
                <small>
                  {member.email} · {member.role}
                </small>
              </div>
              <div className="auth-policy-form" style={{ marginTop: "0.75rem" }}>
                {ALL_CAPS.map((capability) => {
                  const disabled = capability === "manage_billing" && actorRole !== "owner";
                  return (
                    <label className="state-control" key={capability}>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={(drafts[member.userId] ?? []).includes(capability)}
                        onChange={() => toggle(member.userId, capability)}
                      />
                      <span>
                        <strong>{LABELS[capability].title}</strong>
                        <small>{LABELS[capability].hint}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <button type="button" className="primary-action" onClick={() => void saveCapabilities(member.userId)}>
                  Save capabilities
                </button>
                <button type="button" onClick={() => void promoteAdmin(member.userId)}>
                  Promote to team admin
                </button>
              </div>
            </article>
          ))}
        </>
      )}
    </Panel>
  );
}
