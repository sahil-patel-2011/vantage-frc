"use client";

/**
 * Everyone on a team in one table: their access, the parts of the app they can open, and their
 * extra powers. Ticks are kept as a draft until "Save changes", so an owner can set up a whole
 * team and save once. The grid only collects choices: each page passes `onSave`, which goes
 * through that page's own API (Team admin's members API, or Platform admin's for the platform
 * owner), so the same database checks decide.
 */

import { useMemo, useState } from "react";
import { roleLabel, ROLE_LABELS } from "@vantage/core/role-words";
import { CLIENT_HUB_IDS, type ClientHubId } from "../lib/nav/hub-access-filter";
import { PROFILE_CAPABILITIES, PROFILE_HUBS } from "../lib/team/role-profile-copy";
import {
  draftFor,
  GRID_POWERS,
  isLimitedRole,
  pageLimits,
  rowChange,
  toggleSection,
  togglePower,
  withRole,
  type GridChange,
  type GridDraft,
  type GridMember,
} from "../lib/team/permissions-grid";
import { Button } from "./ui";
import "./permissions-grid.css";

export type GridEditable = { ok: true } | { ok: false; reason: string };

type View = "sections" | "powers";
type Column = { id: string; label: string; hint: string };

const ROLE_OPTIONS = ["admin", "scout", "viewer"] as const;

const SECTION_COLUMNS: Column[] = CLIENT_HUB_IDS.map((id) => {
  const hub = PROFILE_HUBS.find((entry) => entry.id === id);
  return { id, label: hub?.label ?? id, hint: hub?.hint ?? "" };
});

const POWER_COLUMNS: Column[] = GRID_POWERS.map((power) => {
  const copy = PROFILE_CAPABILITIES.find((entry) => entry.id === power.id);
  return { id: power.id, label: power.short, hint: copy ? `${copy.label}: ${copy.hint}` : "" };
});

export function PermissionsGrid({
  members,
  canEdit,
  canMakeMentor,
  canGrantBilling,
  onSave,
  onSaved,
}: {
  members: GridMember[];
  /** Whether this person's row can be changed here, and why not. */
  canEdit: (member: GridMember) => GridEditable;
  canMakeMentor: boolean;
  canGrantBilling: boolean;
  /** Save one person; resolves to an error sentence, or null when it saved. */
  onSave: (member: GridMember, change: GridChange) => Promise<string | null>;
  /** Reload the members after a save. */
  onSaved: () => Promise<void> | void;
}) {
  const [view, setView] = useState<View>("sections");
  const [drafts, setDrafts] = useState<Record<string, GridDraft>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone?: "error" } | null>(null);

  const changes = useMemo(
    () =>
      members.flatMap((member) => {
        const draft = drafts[member.userId];
        const change = draft ? rowChange(member, draft) : null;
        return change ? [{ member, change }] : [];
      }),
    [drafts, members],
  );

  function update(member: GridMember, next: (draft: GridDraft) => GridDraft) {
    setStatus(null);
    setDrafts((current) => ({ ...current, [member.userId]: next(current[member.userId] ?? draftFor(member)) }));
  }

  async function save() {
    if (busy || !changes.length) return;
    setBusy(true);
    setStatus(null);
    const failed: Record<string, string> = {};
    let saved = 0;
    try {
      // One person at a time, so one refusal never undoes the others.
      for (const { member, change } of changes) {
        try {
          const error = await onSave(member, change);
          if (error) failed[member.userId] = error;
          else saved += 1;
        } catch {
          failed[member.userId] = "That didn't save. Check your connection and try again.";
        }
      }
      setRowErrors(failed);
      await onSaved();
      // Rows that didn't save keep their ticks, so nothing chosen is lost.
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([userId]) => failed[userId])));
      const failedCount = Object.keys(failed).length;
      const savedText = saved ? `Saved ${saved} ${saved === 1 ? "person" : "people"}.` : "";
      setStatus(
        failedCount
          ? { text: `${savedText} ${failedCount} didn't save; the reason is on the row.`.trim(), tone: "error" }
          : { text: `${savedText} Changes apply the next time they open a page.` },
      );
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setDrafts({});
    setRowErrors({});
    setStatus(null);
  }

  const columns = view === "sections" ? SECTION_COLUMNS : POWER_COLUMNS;

  return (
    <section className="perm-grid" aria-label="Roles and permissions">
      <div className="perm-grid-toolbar">
        <div className="perm-grid-switch" role="group" aria-label="Show">
          <button type="button" aria-pressed={view === "sections"} onClick={() => setView("sections")}>
            Sections
          </button>
          <button type="button" aria-pressed={view === "powers"} onClick={() => setView("powers")}>
            Extra powers
          </button>
        </div>
        <p className="app-muted perm-grid-lede">
          {view === "sections"
            ? "Tick the parts of the app each student or parent can open. Owners, mentors and coaches open everything."
            : "Let a student or parent do one mentor job without making them a mentor."}
        </p>
      </div>

      {members.length === 0 ? (
        <p className="app-muted">Nobody is on this team yet.</p>
      ) : (
        <div className="perm-grid-scroll" role="region" aria-label="Permissions table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Access</th>
                {columns.map((column) => (
                  <th key={column.id} scope="col" title={column.hint}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const draft = drafts[member.userId] ?? draftFor(member);
                const editable = canEdit(member);
                const locked = busy || !editable.ok;
                const who = member.name || member.email;
                const limited = isLimitedRole(draft.role);
                const lead = draft.capabilities.includes("manage_scouting");
                const dirty = Boolean(drafts[member.userId] && rowChange(member, draft));
                return (
                  <tr key={member.userId} className={dirty ? "is-dirty" : undefined}>
                    <th scope="row" className="perm-grid-person">
                      <strong>{who}</strong>
                      {member.email && member.email !== who ? <small>{member.email}</small> : null}
                      {dirty ? <span className="perm-grid-changed">Not saved yet</span> : null}
                      {rowErrors[member.userId] ? (
                        <small className="perm-grid-error" role="alert">
                          {rowErrors[member.userId]}
                        </small>
                      ) : null}
                    </th>
                    <td className="perm-grid-role">
                      {editable.ok ? (
                        <select
                          aria-label={`Access for ${who}`}
                          value={draft.role}
                          disabled={busy}
                          onChange={(event) => {
                            const role = event.target.value;
                            update(member, (current) => withRole(member, current, role));
                          }}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option
                              key={role}
                              value={role}
                              disabled={role === "admin" && !canMakeMentor && member.role !== "admin"}
                            >
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <strong>{roleLabel(member.role)}</strong>
                          <small>{editable.reason}</small>
                        </>
                      )}
                    </td>
                    {columns.map((column) => {
                      if (!limited) {
                        return (
                          <td key={column.id} className="perm-grid-cell">
                            <span className="perm-grid-all" title="Owners, mentors and coaches have this">
                              <span aria-hidden="true">✓</span>
                              <span className="sr-only">Included</span>
                            </span>
                          </td>
                        );
                      }
                      if (view === "sections") {
                        const hubId = column.id as ClientHubId;
                        const forced = hubId === "competition" && lead;
                        const checked = forced || draft.open.includes(hubId);
                        const some = checked && !forced && pageLimits(member, hubId).length > 0;
                        return (
                          <td key={column.id} className="perm-grid-cell">
                            <label title={forced ? "Scouting leads open every Competition page." : column.hint}>
                              <input
                                type="checkbox"
                                aria-label={`${who}: ${column.label}`}
                                checked={checked}
                                disabled={locked || forced || (checked && draft.open.length === 1)}
                                onChange={() => update(member, (current) => toggleSection(current, hubId))}
                              />
                              {some ? <small>Some pages</small> : null}
                            </label>
                          </td>
                        );
                      }
                      const ownerOnly = column.id === "manage_billing" && !canGrantBilling;
                      return (
                        <td key={column.id} className="perm-grid-cell">
                          <label title={ownerOnly ? "Only the team owner can give this." : column.hint}>
                            <input
                              type="checkbox"
                              aria-label={`${who}: ${column.label}`}
                              checked={draft.capabilities.includes(column.id)}
                              disabled={locked || ownerOnly}
                              onChange={() => update(member, (current) => togglePower(current, column.id))}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {status ? (
        <p className="perm-grid-status" data-tone={status.tone} role="status">
          {status.text}
        </p>
      ) : null}

      {changes.length ? (
        <div className="perm-grid-savebar" role="region" aria-label="Unsaved changes">
          <span>
            {changes.length} {changes.length === 1 ? "person" : "people"} changed
          </span>
          <Button variant="secondary" type="button" disabled={busy} onClick={discard}>
            Discard
          </Button>
          <Button variant="primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
