"use client";

/**
 * Role profiles — the named jobs a team hands out.
 *
 * The member editor above this can already set a role, four capability
 * checkboxes and a hub allowlist per person. That is the plumbing; this is the
 * part a lead actually thinks in. Define "Team lead" or "Drive coach" once, then
 * apply it to a person in one click and know the next lead gets the same access.
 *
 * Applying only writes the ordinary role/capability/hub rows, so what the
 * database enforces is unchanged — see packages/core/src/role-profiles.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "../../components/ui";
import {
  BASE_ROLE_COPY,
  PROFILE_CAPABILITIES,
  PROFILE_HUBS,
  type ProfileBaseRole,
  isRoleProfileDenied,
} from "../../lib/team/role-profile-copy";
import "./role-profiles.css";

type Profile = {
  key: string;
  name: string;
  description: string;
  baseRole: ProfileBaseRole;
  capabilities: string[];
  hubAccess: Record<string, string[]>;
};

type Member = { userId: string; name: string; email: string; role: string };

type Draft = {
  key: string;
  name: string;
  description: string;
  baseRole: ProfileBaseRole;
  capabilities: string[];
  hubs: string[];
};

const emptyDraft = (): Draft => ({
  key: "",
  name: "",
  description: "",
  baseRole: "scout",
  capabilities: [],
  hubs: [],
});

const draftOf = (profile: Profile): Draft => ({
  key: profile.key,
  name: profile.name,
  description: profile.description,
  baseRole: profile.baseRole,
  capabilities: [...profile.capabilities],
  hubs: Object.keys(profile.hubAccess),
});

/** One line a student can read: what this profile actually opens. */
function profileSummary(profile: Profile): string {
  if (profile.baseRole === "admin") return "Everything, including team settings";
  const hubs = Object.keys(profile.hubAccess);
  const where = hubs.length
    ? hubs.map((id) => PROFILE_HUBS.find((hub) => hub.id === id)?.label ?? id).join(", ")
    : "Every section";
  const extras = profile.capabilities
    .map((id) => PROFILE_CAPABILITIES.find((cap) => cap.id === id)?.label)
    .filter(Boolean);
  const read = profile.baseRole === "viewer" ? " (read-only)" : "";
  return extras.length ? `${where}${read} · ${extras.join(" · ")}` : `${where}${read}`;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function RoleProfilesPanel({ orgId }: { orgId: string }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [applyTo, setApplyTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [profileResponse, memberResponse] = await Promise.all([
        fetch(`/api/organizations/role-profiles?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`),
      ]);
      const profileData = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileData.error ?? "Could not load role profiles");
      setActorRole(typeof profileData.actorRole === "string" ? profileData.actorRole : null);
      setProfiles(profileData.profiles ?? []);
      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        setMembers(
          (memberData.members ?? []).filter((member: Member) => member.role !== "owner"),
        );
      }
    } catch (cause) {
      setProfiles([]);
      setError(cause instanceof Error ? cause.message : "Could not load role profiles");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/organizations/role-profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...body }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "That did not save");
        setNotice(success);
        await load();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, orgId],
  );

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const saved = await post(
      {
        action: "save",
        key: draft.key || draft.name,
        name: draft.name,
        description: draft.description,
        baseRole: draft.baseRole,
        capabilities: draft.baseRole === "admin" ? [] : draft.capabilities,
        hubAccess:
          draft.baseRole === "admin"
            ? {}
            : Object.fromEntries(draft.hubs.map((hub) => [hub, [] as string[]])),
      },
      `Saved ${draft.name}.`,
    );
    if (saved) setDraft(null);
  }, [draft, post]);

  const sorted = useMemo(() => profiles ?? [], [profiles]);
  const canEdit = actorRole === "owner" || actorRole === "admin";

  if (error && isRoleProfileDenied(error)) return null;

  return (
    <Card
      className="rpf"
      title="Role profiles"
      subtitle={
        canEdit
          ? "Name the jobs on your team once, then give someone that job in one click. Applying a profile sets the same role, permissions and sections you could set by hand."
          : "These are the named jobs on your team. An owner or admin is the one who applies them."
      }
      actions={
        draft || error || profiles === null || !canEdit ? null : (
          <Button variant="primary" onClick={() => setDraft(emptyDraft())}>
            New profile
          </Button>
        )
      }
    >
      {error ? <p className="rpf-error">{error}</p> : null}
      {notice ? <p className="rpf-notice">{notice}</p> : null}

      {draft ? (
        <form
          className="rpf-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <div className="rpf-row">
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Drive coach"
                maxLength={60}
                required
              />
            </label>
            <label>
              <span>What they are</span>
              <select
                value={draft.baseRole}
                onChange={(event) =>
                  setDraft({ ...draft, baseRole: event.target.value as ProfileBaseRole })
                }
              >
                {(Object.keys(BASE_ROLE_COPY) as ProfileBaseRole[]).map((role) => (
                  <option key={role} value={role}>
                    {BASE_ROLE_COPY[role].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="rpf-hint">{BASE_ROLE_COPY[draft.baseRole].hint}</p>

          <label className="rpf-wide">
            <span>Description</span>
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="Runs the pit and calls the match."
              maxLength={280}
            />
          </label>

          {draft.baseRole === "admin" ? null : (
            <>
              <fieldset className="rpf-set">
                <legend>Sections they can open</legend>
                <p className="rpf-hint">Pick none to leave every section open.</p>
                <div className="rpf-checks">
                  {PROFILE_HUBS.map((hub) => (
                    <label key={hub.id}>
                      <input
                        type="checkbox"
                        checked={draft.hubs.includes(hub.id)}
                        onChange={() => setDraft({ ...draft, hubs: toggle(draft.hubs, hub.id) })}
                      />
                      <span>
                        <strong>{hub.label}</strong>
                        <small>{hub.hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rpf-set">
                <legend>Extra permissions</legend>
                <div className="rpf-checks">
                  {PROFILE_CAPABILITIES.map((capability) => (
                    <label key={capability.id}>
                      <input
                        type="checkbox"
                        checked={draft.capabilities.includes(capability.id)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            capabilities: toggle(draft.capabilities, capability.id),
                          })
                        }
                      />
                      <span>
                        <strong>{capability.label}</strong>
                        <small>{capability.hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <div className="rpf-actions">
            <Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>
              {busy ? "Saving…" : "Save profile"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {profiles === null ? (
        <p className="rpf-hint">Loading profiles…</p>
      ) : sorted.length === 0 ? (
        <p className="rpf-hint">
          {canEdit ? "No profiles yet. Create one and it becomes a one-click job." : "No named jobs yet."}
        </p>
      ) : (
        <ul className="rpf-list">
          {sorted.map((profile) => (
            <li key={profile.key}>
              <div className="rpf-item-head">
                <strong>{profile.name}</strong>
                <span className="rpf-badge">{BASE_ROLE_COPY[profile.baseRole].label}</span>
              </div>
              {profile.description ? <p className="rpf-desc">{profile.description}</p> : null}
              <p className="rpf-grants">{profileSummary(profile)}</p>
              {canEdit ? (
              <div className="rpf-item-actions">
                <label className="rpf-apply">
                  <span className="rpf-sr">Apply {profile.name} to</span>
                  <select
                    value={applyTo[profile.key] ?? ""}
                    onChange={(event) =>
                      setApplyTo({ ...applyTo, [profile.key]: event.target.value })
                    }
                  >
                    <option value="">Apply to…</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name || member.email}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !applyTo[profile.key]}
                  onClick={() =>
                    void post(
                      { action: "apply", key: profile.key, userId: applyTo[profile.key] },
                      `${profile.name} applied.`,
                    ).then((ok) => {
                      if (ok) setApplyTo({ ...applyTo, [profile.key]: "" });
                    })
                  }
                >
                  Apply
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(profile))}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void post({ action: "delete", key: profile.key }, `${profile.name} removed.`)
                  }
                >
                  Delete
                </Button>
              </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <p className="rpf-hint">
          A profile is a preset. Editing it later does not change anyone already set up — apply it
          again to move them.
        </p>
      ) : null}
    </Card>
  );
}
