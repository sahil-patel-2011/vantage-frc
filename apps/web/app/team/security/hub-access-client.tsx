"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, Panel } from "../../../components/ui";
import { CLIENT_HUB_IDS, type ClientHubId } from "../../../lib/nav/hub-access-filter";
import { PRODUCT_HUBS } from "../../../lib/nav/hubs";

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

type HubAccessRow = {
  hubId: ClientHubId;
  allowedTabIds: string[];
};

const HUB_LABELS: Record<ClientHubId, string> = {
  competition: "Competition",
  team: "Team",
  business: "Business",
  build: "Build",
  ai: "AI",
  media: "Media",
};

function tabsForHub(hubId: ClientHubId): Array<{ id: string; label: string }> {
  const hub = PRODUCT_HUBS.find((entry) => entry.id === hubId);
  if (!hub) return [];
  return hub.tabs.map((tab) => ({ id: tab.id, label: tab.label }));
}

function rowsToDraft(rows: HubAccessRow[] | undefined): Record<ClientHubId, string[] | null> {
  const next: Record<ClientHubId, string[] | null> = {
    competition: null,
    team: null,
    business: null,
    build: null,
    ai: null,
    media: null,
  };
  if (!rows?.length) return next;
  for (const row of rows) {
    if (!(CLIENT_HUB_IDS as readonly string[]).includes(row.hubId)) continue;
    next[row.hubId] = [...(row.allowedTabIds ?? [])];
  }
  return next;
}

function draftToPayload(draft: Record<ClientHubId, string[] | null>): HubAccessRow[] {
  return CLIENT_HUB_IDS.filter((hubId) => draft[hubId] !== null).map((hubId) => ({
    hubId,
    allowedTabIds: draft[hubId] ?? [],
  }));
}

export default function HubAccessClient({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [hubAccessByUser, setHubAccessByUser] = useState<Record<string, HubAccessRow[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<ClientHubId, string[] | null>>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const hubCatalog = useMemo(() => CLIENT_HUB_IDS, []);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Unable to load members");
      setLoading(false);
      return;
    }
    const nextMembers = (data.members ?? []) as Member[];
    const byUser = (data.hubAccessByUser ?? {}) as Record<string, HubAccessRow[]>;
    setMembers(nextMembers);
    setHubAccessByUser(byUser);
    const nextDrafts: Record<string, Record<ClientHubId, string[] | null>> = {};
    for (const member of nextMembers) {
      nextDrafts[member.userId] = rowsToDraft(byUser[member.userId]);
    }
    setDrafts(nextDrafts);
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  function toggleHub(userId: string, hubId: ClientHubId) {
    setDrafts((prev) => {
      const current = prev[userId] ?? rowsToDraft(hubAccessByUser[userId]);
      const enabled = current[hubId] !== null;
      return {
        ...prev,
        [userId]: {
          ...current,
          [hubId]: enabled ? null : [],
        },
      };
    });
  }

  function toggleTab(userId: string, hubId: ClientHubId, tabId: string) {
    setDrafts((prev) => {
      const current = prev[userId] ?? rowsToDraft(hubAccessByUser[userId]);
      const tabs = current[hubId];
      if (tabs === null) return prev;
      const nextTabs = tabs.includes(tabId) ? tabs.filter((id) => id !== tabId) : [...tabs, tabId];
      return {
        ...prev,
        [userId]: {
          ...current,
          [hubId]: nextTabs,
        },
      };
    });
  }

  function clearAll(userId: string) {
    setDrafts((prev) => ({
      ...prev,
      [userId]: rowsToDraft([]),
    }));
  }

  async function saveHubAccess(userId: string) {
    setSavingUserId(userId);
    const draft = drafts[userId] ?? rowsToDraft(hubAccessByUser[userId]);
    const response = await fetch("/api/organizations/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        userId,
        action: "set_hub_access",
        hubAccess: draftToPayload(draft),
      }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? draftToPayload(draft).length
          ? "Hub access updated and audited."
          : "Hub access cleared — member is unrestricted."
        : (data.error ?? "Could not save hub access."),
    );
    setSavingUserId(null);
    if (response.ok) await load();
  }

  const editable = members.filter((member) => member.role === "scout" || member.role === "viewer");
  const admins = members.filter((member) => member.role === "owner" || member.role === "admin");

  return (
    <Panel className="member-hub-access-panel">
      <span className="eyebrow">Section allowlists</span>
      <h2>Hub access</h2>
      <p className="app-muted">
        Limit scouts and viewers to specific Soft-UI hubs. Start unrestricted (no hubs checked). Enabling a hub shows
        it; leave its tabs unchecked for every tab, or check tabs to restrict to those only. Clear all restores full
        navigation. Owners and admins stay unrestricted.
      </p>
      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}
      {loading ? (
        <EmptyState soft title="Loading hub access…" description="Pulling members and section allowlists." aria-busy />
      ) : (
        <>
          <div className="invite-list" style={{ marginBottom: "1rem" }}>
            {admins.map((member) => (
              <article key={member.userId}>
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.email} · {member.role} · unrestricted hub access
                  </small>
                </div>
              </article>
            ))}
          </div>
          {!editable.length ? (
            <EmptyState
              soft
              title="No scouts or viewers to restrict"
              description="Invite members from Team admin, then limit Competition, Team, Business, Build, AI, or Media here."
            >
              <a className="app-button secondary" href={`/team/admin?orgId=${encodeURIComponent(orgId)}`}>
                Open Team admin
              </a>
            </EmptyState>
          ) : null}
          {editable.map((member) => {
            const draft = drafts[member.userId] ?? rowsToDraft(hubAccessByUser[member.userId]);
            const enabledCount = hubCatalog.filter((hubId) => draft[hubId] !== null).length;
            const unrestricted = enabledCount === 0;
            return (
              <article className="admin-org" key={member.userId} style={{ marginBottom: "1rem" }}>
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.email} · {member.role}
                    {unrestricted ? " · unrestricted" : ` · ${enabledCount} hub${enabledCount === 1 ? "" : "s"}`}
                  </small>
                </div>
                <div className="auth-policy-form" style={{ marginTop: "0.75rem" }}>
                  {hubCatalog.map((hubId) => {
                    const enabled = draft[hubId] !== null;
                    const tabs = tabsForHub(hubId);
                    const selectedTabs = draft[hubId] ?? [];
                    return (
                      <div key={hubId} style={{ marginBottom: "0.75rem" }}>
                        <label className="state-control">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => toggleHub(member.userId, hubId)}
                          />
                          <span>
                            <strong>{HUB_LABELS[hubId]}</strong>
                            <small>
                              {enabled
                                ? selectedTabs.length
                                  ? `${selectedTabs.length} tab${selectedTabs.length === 1 ? "" : "s"} selected`
                                  : "All tabs in this hub"
                                : "Hidden from this member"}
                            </small>
                          </span>
                        </label>
                        {enabled && tabs.length ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "0.35rem 0.75rem",
                              margin: "0.4rem 0 0 1.75rem",
                            }}
                          >
                            {tabs.map((tab) => (
                              <label key={tab.id} className="check-field" style={{ fontSize: 13 }}>
                                <input
                                  type="checkbox"
                                  checked={selectedTabs.includes(tab.id)}
                                  onChange={() => toggleTab(member.userId, hubId, tab.id)}
                                />{" "}
                                {tab.label}
                              </label>
                            ))}
                            <small className="app-muted" style={{ flexBasis: "100%" }}>
                              Leave tabs unchecked for full access within {HUB_LABELS[hubId]}. Checking any tab
                              limits to those tabs only.
                            </small>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={savingUserId === member.userId}
                    onClick={() => void saveHubAccess(member.userId)}
                  >
                    {savingUserId === member.userId ? "Saving…" : "Save hub access"}
                  </button>
                  <button type="button" onClick={() => clearAll(member.userId)}>
                    Clear all (unrestricted)
                  </button>
                </div>
              </article>
            );
          })}
        </>
      )}
    </Panel>
  );
}
