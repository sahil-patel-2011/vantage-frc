"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, Panel, Button } from "../../../components/ui";
import { CLIENT_HUB_IDS, type ClientHubId } from "../../../lib/nav/hub-access-filter";
import { PRODUCT_HUBS } from "../../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";

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

type HubAccessSnapshot = {
  members: Member[];
  hubAccessByUser: Record<string, HubAccessRow[]>;
};

function isAdministratorDenial(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      "error" in data &&
      (data as { error?: unknown }).error === "Organization administrator access required",
  );
}

function isHubAccessSnapshot(value: unknown): value is HubAccessSnapshot {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { members?: unknown }).members);
}

async function persistHubAccessSnapshot(orgId: string, data: HubAccessSnapshot): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("hub-access", orgId, data);
  } catch {
    // Live hub access already painted; IndexedDB is best-effort.
  }
}

export default function HubAccessClient({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [hubAccessByUser, setHubAccessByUser] = useState<Record<string, HubAccessRow[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<ClientHubId, string[] | null>>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  /** True only after a member list actually loaded. A refused load must not offer Team admin. */
  const [rosterReady, setRosterReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const membersRef = useRef<Member[]>([]);
  membersRef.current = members;

  const hubCatalog = useMemo(() => CLIENT_HUB_IDS, []);

  const applySnapshot = useCallback((data: HubAccessSnapshot, cached: boolean, cachedAtValue: string | null) => {
    setMembers(data.members);
    setHubAccessByUser(data.hubAccessByUser);
    const nextDrafts: Record<string, Record<ClientHubId, string[] | null>> = {};
    for (const member of data.members) {
      nextDrafts[member.userId] = rowsToDraft(data.hubAccessByUser[member.userId]);
    }
    setDrafts(nextDrafts);
    setFromCache(cached);
    setCachedAt(cachedAtValue);
    setRosterReady(true);
    setDenied(false);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    let hadCache = membersRef.current.length > 0;
    try {
      const cached = await getFeatureSnapshot<HubAccessSnapshot>("hub-access", orgId);
      if (cached?.data && isHubAccessSnapshot(cached.data)) {
        if (!membersRef.current.length) applySnapshot(cached.data, true, cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    try {
      const response = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403 || isAdministratorDenial(data)) {
        setMembers([]);
        setDenied(true);
        setFromCache(false);
        setCachedAt(null);
        setMessage("");
        setLoading(false);
        return;
      }
      if (!response.ok || !data || typeof data !== "object") {
        if (hadCache || membersRef.current.length) {
          setFromCache(true);
          setMessage("Could not refresh hub access. Showing the last copy on this device.");
          setLoading(false);
          return;
        }
        setMessage(
          data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to load members",
        );
        setLoading(false);
        return;
      }
      const nextMembers = ((data as { members?: Member[] }).members ?? []) as Member[];
      const byUser = ((data as { hubAccessByUser?: Record<string, HubAccessRow[]> }).hubAccessByUser ??
        {}) as Record<string, HubAccessRow[]>;
      const snapshot: HubAccessSnapshot = { members: nextMembers, hubAccessByUser: byUser };
      applySnapshot(snapshot, false, null);
      setMessage("");
      await persistHubAccessSnapshot(orgId, snapshot);
    } catch {
      if (hadCache || membersRef.current.length) {
        setFromCache(true);
        setMessage("Could not refresh hub access. Showing the last copy on this device.");
        setLoading(false);
        return;
      }
      setMessage("Unable to load members");
      setLoading(false);
    }
  }, [applySnapshot, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One "Can open …" switch per hub, on by default. The stored shape is an allowlist (no rows
   * means every hub), so switching one off from "everything" allows every other hub; switching
   * the last one back on returns to "no limits". At least one hub stays on: an empty
   * allowlist would mean no limits, the opposite of what the owner just did.
   */
  function toggleHub(userId: string, hubId: ClientHubId) {
    setDrafts((prev) => {
      const current = prev[userId] ?? rowsToDraft(hubAccessByUser[userId]);
      const unrestricted = CLIENT_HUB_IDS.every((id) => current[id] === null);
      let next: Record<ClientHubId, string[] | null>;
      if (unrestricted) {
        next = { ...current };
        for (const id of CLIENT_HUB_IDS) next[id] = id === hubId ? null : [];
      } else if (current[hubId] !== null) {
        const others = CLIENT_HUB_IDS.filter((id) => id !== hubId && current[id] !== null);
        if (!others.length) return prev;
        next = { ...current, [hubId]: null };
      } else {
        next = { ...current, [hubId]: [] };
      }
      const allOpen = CLIENT_HUB_IDS.every((id) => next[id] !== null && next[id]!.length === 0);
      return { ...prev, [userId]: allOpen ? rowsToDraft([]) : next };
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
      <OfflineBanner feature="Team security" fromCache={fromCache} cachedAt={cachedAt} />
      <span className="eyebrow">Who can open what</span>
      <h2>Hub access</h2>
      {denied ? (
        <EmptyState
          soft
          badge="No access"
          badgeTone="setup"
          title="Owners and admins set hub access"
          description="An owner or admin limits which hubs scouts and viewers can open."
        />
      ) : (
      <>
      <p className="app-muted">
        Students and guests can open every hub until you switch one off. Inside a hub you can also keep only some
        tabs. Owners and admins always see everything.
      </p>
      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}
      {loading ? (
        <EmptyState soft title="Loading hub access…" description="Loading members and which sections they can open." aria-busy />
      ) : (
        <>
          <div className="invite-list" style={{ marginBottom: "1rem" }}>
            {admins.map((member) => (
              <article key={member.userId}>
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.email} · {member.role} · sees every hub
                  </small>
                </div>
              </article>
            ))}
          </div>
          {rosterReady && !editable.length ? (
            <EmptyState
              soft
              title="No scouts or viewers to restrict"
              description="Invite members from Team admin, then limit Competition, Team, Business, Build, AI, or Media here."
            >
              <Button as="a" variant="secondary" href={`/team/admin?orgId=${encodeURIComponent(orgId)}`}>
                Open Team admin
              </Button>
            </EmptyState>
          ) : null}
          {editable.map((member) => {
            const draft = drafts[member.userId] ?? rowsToDraft(hubAccessByUser[member.userId]);
            const enabledCount = hubCatalog.filter((hubId) => draft[hubId] !== null).length;
            const unrestricted = enabledCount === 0;
            const openCount = unrestricted ? hubCatalog.length : enabledCount;
            return (
              // One line per member until you open it: the six hub checkboxes for every
              // scout made this page ~5,500px for three people.
              <details className="admin-org member-access-row" key={member.userId}>
                <summary>
                  <span className="member-access-who">
                    <strong>{member.name}</strong>
                    <small>
                      {member.email} · {member.role}
                    </small>
                  </span>
                  <span className="member-access-state">
                    {unrestricted ? "Sees every hub" : `Sees ${openCount} of ${hubCatalog.length} hubs`}
                  </span>
                  <span className="member-access-edit" aria-hidden="true">
                    Edit
                  </span>
                </summary>
                <div className="auth-policy-form" style={{ marginTop: "0.75rem" }}>
                  {hubCatalog.map((hubId) => {
                    const enabled = unrestricted || draft[hubId] !== null;
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
                            <strong>Can open {HUB_LABELS[hubId]}</strong>
                            <small>
                              {!enabled
                                ? "Hidden from this member"
                                : selectedTabs.length
                                  ? `Only ${selectedTabs.length} tab${selectedTabs.length === 1 ? "" : "s"}`
                                  : "Every tab"}
                            </small>
                          </span>
                        </label>
                        {!unrestricted && enabled && tabs.length ? (
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
                    Show every hub
                  </button>
                </div>
              </details>
            );
          })}
        </>
      )}
      </>
      )}
    </Panel>
  );
}
