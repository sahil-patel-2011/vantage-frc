"use client";

/**
 * One "Access" panel per person — role first, then Advanced.
 *
 * This used to be four screens: a role dropdown on Team admin, hub access and
 * member capabilities on Team security, and "Give budget access to" on /budget.
 * The panel only collects the choices; every change still goes through the
 * same APIs (and so the same RLS and capability checks) as before:
 *   - role, hub access, extra powers → PATCH /api/organizations/members
 *   - budget access                  → POST  /api/budget (grant/revoke)
 *   - presets                        → POST  /api/organizations/role-profiles (apply)
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "../../../components/ui";
import { CLIENT_HUB_IDS, type ClientHubId } from "../../../lib/nav/hub-access-filter";
import { PRODUCT_HUBS } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { PROFILE_CAPABILITIES, PROFILE_HUBS } from "../../../lib/team/role-profile-copy";
import "./member-access.css";

export type AccessMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  capabilities?: string[];
};

export type HubAccessRow = { hubId: string; allowedTabIds: string[] };

type Preset = { key: string; name: string; description: string };

const ROLE_CHOICES: Array<{ id: "scout" | "admin" | "viewer"; label: string; hint: string }> = [
  { id: "scout", label: "Student", hint: "Scouts and uses team tools." },
  {
    id: "admin",
    label: "Mentor or coach",
    hint: "Can also invite and remove people, change team settings and add AI keys.",
  },
  { id: "viewer", label: "Parent or guest", hint: "Can look, can't change." },
];

export const ROLE_WORDS: Record<string, string> = {
  owner: "an owner",
  admin: "a mentor or coach",
  scout: "a student",
  viewer: "a parent or guest",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Mentor or coach",
  scout: "Student",
  viewer: "Parent or guest",
};

function hubLabel(hubId: ClientHubId): { label: string; hint: string } {
  const entry = PROFILE_HUBS.find((hub) => hub.id === hubId);
  return { label: entry?.label ?? hubId, hint: entry?.hint ?? "" };
}

/*
  The pages to tick are a section's main tabs (Event day, Scouting, Strategy, Robot check), not
  the ~55 tools inside them ("Heat signals", "Schema sync"). A tool follows the tab it sits under:
  saving expands the ticked tabs to the tools inside them, so the stored access is the same shape.
*/
function tabsForHub(hubId: ClientHubId): Array<{ id: string; label: string }> {
  const hub = PRODUCT_HUBS.find((entry) => entry.id === hubId);
  return hub ? hub.tabs.filter((tab) => !tab.group).map((tab) => ({ id: tab.id, label: tab.label })) : [];
}

function withNestedTools(hubId: ClientHubId, mainTabs: string[]): string[] {
  const hub = PRODUCT_HUBS.find((entry) => entry.id === hubId);
  if (!hub || !mainTabs.length) return mainTabs;
  const nested = hub.tabs.filter((tab) => tab.group && mainTabs.includes(tab.group)).map((tab) => tab.id);
  return [...new Set([...mainTabs, ...nested])];
}

type HubDraft = { open: ClientHubId[]; tabs: Partial<Record<ClientHubId, string[]>> };

function hubDraftFromRows(rows: HubAccessRow[]): HubDraft {
  const known = rows.filter((row) => (CLIENT_HUB_IDS as readonly string[]).includes(row.hubId));
  if (!known.length) return { open: [...CLIENT_HUB_IDS], tabs: {} };
  const tabs: Partial<Record<ClientHubId, string[]>> = {};
  for (const row of known) {
    const main = new Set(tabsForHub(row.hubId as ClientHubId).map((tab) => tab.id));
    tabs[row.hubId as ClientHubId] = (row.allowedTabIds ?? []).filter((id) => main.has(id));
  }
  return { open: known.map((row) => row.hubId as ClientHubId), tabs };
}

/** Everything open and no tab limits is stored as "no rows" — no limits at all. */
function hubPayload(draft: HubDraft): HubAccessRow[] {
  const everything =
    draft.open.length === CLIENT_HUB_IDS.length && draft.open.every((id) => !(draft.tabs[id]?.length));
  if (everything) return [];
  return CLIENT_HUB_IDS.filter((id) => draft.open.includes(id)).map((hubId) => ({
    hubId,
    allowedTabIds: withNestedTools(hubId, draft.tabs[hubId] ?? []),
  }));
}

function samePayload(a: HubAccessRow[], b: HubAccessRow[]): boolean {
  const key = (rows: HubAccessRow[]) =>
    JSON.stringify(
      [...rows]
        .map((row) => ({ hubId: row.hubId, tabs: [...row.allowedTabIds].sort() }))
        .sort((x, y) => x.hubId.localeCompare(y.hubId)),
    );
  return key(a) === key(b);
}

async function patchMember(orgId: string, body: Record<string, unknown>): Promise<string | null> {
  const response = await fetch("/api/organizations/members", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId, ...body }),
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "That didn't save. Try again.";
}

export function MemberAccessPanel({
  orgId,
  member,
  actorRole,
  actorUserId,
  hubRows,
  onClose,
  onSaved,
}: {
  orgId: string;
  member: AccessMember | null;
  actorRole: string | null;
  actorUserId: string | null;
  hubRows: HubAccessRow[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [role, setRole] = useState("scout");
  const [caps, setCaps] = useState<string[]>([]);
  const [hubs, setHubs] = useState<HubDraft>({ open: [...CLIENT_HUB_IDS], tabs: {} });
  const [tabsOpenFor, setTabsOpenFor] = useState<ClientHubId | null>(null);
  const [budgetKnown, setBudgetKnown] = useState(false);
  const [budgetGranted, setBudgetGranted] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const userId = member?.userId ?? null;

  useEffect(() => {
    if (!member) return;
    setRole(member.role);
    setCaps([...(member.capabilities ?? [])]);
    setHubs(hubDraftFromRows(hubRows));
    setTabsOpenFor(null);
    setPreset("");
    setError("");
    setBudgetKnown(false);
    let cancelled = false;
    // Budget access and presets only matter for people who aren't owners or mentors.
    if (member.role === "owner") return;
    void (async () => {
      try {
        const [budgetResponse, presetResponse] = await Promise.all([
          fetch(`/api/budget?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/organizations/role-profiles?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (budgetResponse.ok) {
          const data = (await budgetResponse.json()) as {
            canGrantAccess?: boolean;
            grants?: Array<{ userId: string }>;
          };
          if (!cancelled && data.canGrantAccess) {
            const granted = (data.grants ?? []).some((grant) => grant.userId === member.userId);
            setBudgetGranted(granted);
            setBudgetDraft(granted);
            setBudgetKnown(true);
          }
        }
        if (presetResponse.ok) {
          const data = (await presetResponse.json()) as { profiles?: Preset[] };
          if (!cancelled) setPresets(Array.isArray(data.profiles) ? data.profiles : []);
        }
      } catch {
        // The panel still works for role, sections and powers without these.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the member id: hubRows is a fresh array each render.
  }, [userId, orgId]);

  const originalHubs = useMemo(() => hubPayload(hubDraftFromRows(hubRows)), [hubRows]);

  if (!member) return null;

  const who = member.name || member.email;
  const isOwnerRow = member.role === "owner";
  const isSelf = member.userId === actorUserId;
  const roleEditable = !isOwnerRow && !isSelf && (member.role !== "admin" || actorRole === "owner");
  const limited = role === "scout" || role === "viewer";

  function toggleHub(hubId: ClientHubId) {
    setHubs((current) => {
      if (current.open.includes(hubId)) {
        if (current.open.length === 1) return current; // at least one section stays open
        const tabs = { ...current.tabs };
        delete tabs[hubId];
        return { open: current.open.filter((id) => id !== hubId), tabs };
      }
      return { ...current, open: [...current.open, hubId] };
    });
  }

  /*
    A tick means "they can open this page". Nothing stored means every page, so every box shows
    ticked; unticking one limits them to the rest, and ticking them all back stores nothing again.
    (It used to show every page unticked under "Everything is open".)
  */
  function toggleTab(hubId: ClientHubId, tabId: string) {
    setHubs((current) => {
      const all = tabsForHub(hubId).map((tab) => tab.id);
      const list = current.tabs[hubId]?.length ? current.tabs[hubId]! : all;
      let next = list.includes(tabId) ? list.filter((id) => id !== tabId) : [...list, tabId];
      if (next.length === 0) next = list; // at least one page stays open
      if (all.every((id) => next.includes(id))) next = [];
      return { ...current, tabs: { ...current.tabs, [hubId]: next } };
    });
  }

  /** The chosen preset, applied as part of Save. Returns an error message, or null. */
  async function applyPreset(): Promise<string | null> {
    if (!preset || !member) return null;
    const response = await fetch("/api/organizations/role-profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "apply", key: preset, userId: member.userId }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok ? null : (data.error ?? "That preset didn't apply. Try again.");
  }

  async function save() {
    if (!member) return;
    setBusy(true);
    setError("");
    const changed: string[] = [];
    try {
      if (roleEditable && role !== member.role) {
        const failure = await patchMember(orgId, { userId: member.userId, action: "set_role", role });
        if (failure) return setError(failure);
        changed.push(`${who} is now ${ROLE_WORDS[role] ?? role}.`);
      }
      // A preset is a starting point: it applies first, and anything changed by hand below
      // it in this dialog is saved on top.
      if (limited && preset) {
        const failure = await applyPreset();
        if (failure) return setError(failure);
        changed.push(`${presets.find((entry) => entry.key === preset)?.name ?? "The preset"} applied.`);
      }
      if (limited) {
        const nextHubs = hubPayload(hubs);
        if (!samePayload(nextHubs, originalHubs)) {
          const failure = await patchMember(orgId, {
            userId: member.userId,
            action: "set_hub_access",
            hubAccess: nextHubs,
          });
          if (failure) return setError(failure);
          changed.push(
            nextHubs.length === 0
              ? "They can open every section."
              : `They can open ${hubs.open.map((id) => hubLabel(id).label).join(", ")}.`,
          );
        }
        const before = [...(member.capabilities ?? [])].sort().join(",");
        if ([...caps].sort().join(",") !== before) {
          const failure = await patchMember(orgId, {
            userId: member.userId,
            action: "set_capabilities",
            capabilities: caps,
          });
          if (failure) return setError(failure);
          changed.push(caps.length ? "Extra powers updated." : "Extra powers removed.");
        }
        if (budgetKnown && budgetDraft !== budgetGranted) {
          const response = await fetch(`/api/budget?orgId=${encodeURIComponent(orgId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              orgId,
              action: budgetDraft ? "grant-budget-access" : "revoke-budget-access",
              userId: member.userId,
            }),
          });
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            return setError(data.error ?? "Budget access didn't save. Try again.");
          }
          changed.push(budgetDraft ? "They can see the season budget." : "They can no longer see the season budget.");
        }
      }
      await onSaved(changed.length ? `Saved. ${changed.join(" ")}` : "No changes to save.");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(member)} onClose={onClose} title={`Access for ${who}`} description={member.email}>
      <div className="member-access">
        <fieldset className="member-access-roles" disabled={!roleEditable || busy}>
          <legend>They are a</legend>
          {isOwnerRow ? (
            <p className="app-muted">Owner — can do everything. Owners can&apos;t be changed here.</p>
          ) : (
            ROLE_CHOICES.map((choice) => (
              <label key={choice.id} className={`member-access-role${role === choice.id ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name={`role-${member.userId}`}
                  value={choice.id}
                  checked={role === choice.id}
                  onChange={() => setRole(choice.id)}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.hint}</small>
                </span>
              </label>
            ))
          )}
          {!isOwnerRow && !roleEditable ? (
            <p className="app-muted member-access-note">
              {isSelf ? "You can't change your own role." : "Only an owner can change a mentor's role."}
            </p>
          ) : null}
        </fieldset>

        {limited && presets.length > 0 ? (
          <div className="member-access-preset">
            <label>
              <span>Start from a preset (applied when you save)</span>
              <select value={preset} onChange={(event) => setPreset(event.target.value)} disabled={busy}>
                <option value="">Choose a preset…</option>
                {presets.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {limited ? (
          <details className="member-access-advanced">
            <summary>Advanced: sections, extra powers{budgetKnown ? " and budget" : ""}</summary>

            <section aria-labelledby={`hubs-${member.userId}`}>
              <h3 id={`hubs-${member.userId}`}>Sections they can open</h3>
              <p className="app-muted">Everything is open until you switch something off.</p>
              {CLIENT_HUB_IDS.map((hubId) => {
                const { label, hint } = hubLabel(hubId);
                const open = hubs.open.includes(hubId);
                const tabs = tabsForHub(hubId);
                const chosen = hubs.tabs[hubId] ?? [];
                return (
                  <div key={hubId} className="member-access-hub">
                    <label className="member-access-check">
                      <input
                        type="checkbox"
                        checked={open}
                        disabled={busy || (open && hubs.open.length === 1)}
                        onChange={() => toggleHub(hubId)}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{open ? (chosen.length ? `Only ${chosen.length} of its pages` : hint) : "Hidden"}</small>
                      </span>
                    </label>
                    {open && tabs.length ? (
                      tabsOpenFor === hubId || chosen.length ? (
                        <div className="member-access-tabs">
                          <small className="app-muted">Untick a page to hide it from them.</small>
                          {tabs.map((tab) => (
                            <label key={tab.id}>
                              <input
                                type="checkbox"
                                checked={chosen.length === 0 || chosen.includes(tab.id)}
                                onChange={() => toggleTab(hubId, tab.id)}
                              />{" "}
                              {tab.label}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <button type="button" className="text-button" onClick={() => setTabsOpenFor(hubId)}>
                          Limit to some pages…
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </section>

            <section aria-labelledby={`caps-${member.userId}`}>
              <h3 id={`caps-${member.userId}`}>Extra powers</h3>
              <p className="app-muted">Let them do one mentor job without making them a mentor.</p>
              {PROFILE_CAPABILITIES.map((capability) => {
                const ownerOnly = capability.id === "manage_billing" && actorRole !== "owner";
                return (
                  <label key={capability.id} className="member-access-check">
                    <input
                      type="checkbox"
                      disabled={busy || ownerOnly}
                      checked={caps.includes(capability.id)}
                      onChange={() =>
                        setCaps((current) =>
                          current.includes(capability.id)
                            ? current.filter((id) => id !== capability.id)
                            : [...current, capability.id],
                        )
                      }
                    />
                    <span>
                      <strong>{capability.label}</strong>
                      <small>{capability.hint}</small>
                    </span>
                  </label>
                );
              })}
            </section>

            {budgetKnown ? (
              <section aria-labelledby={`budget-${member.userId}`}>
                <h3 id={`budget-${member.userId}`}>Season budget</h3>
                <label className="member-access-check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={budgetDraft}
                    onChange={(event) => setBudgetDraft(event.target.checked)}
                  />
                  <span>
                    <strong>Can see and change the season budget</strong>
                    <small>Owners and mentors always can.</small>
                  </span>
                </label>
              </section>
            ) : null}
            <p className="app-muted member-access-note">
              Presets for jobs like &ldquo;Drive coach&rdquo; live on{" "}
              <a href={withOrgHref("/team/admin/presets", orgId)}>Access presets</a>.
            </p>
          </details>
        ) : !isOwnerRow ? (
          <p className="app-muted member-access-note">Mentors and coaches can open every section.</p>
        ) : null}

        {error ? (
          <p className="member-access-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="member-access-actions">
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {isOwnerRow ? null : (
            <Button variant="primary" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save access"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
