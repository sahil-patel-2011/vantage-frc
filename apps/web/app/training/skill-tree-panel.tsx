"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, Modal } from "../../components/ui";
import type { TrainingView } from "../../lib/training/compute-training";
import { buildSkillTreeModel, MAX_GROUP_SIGN_OFF, signOffBlocker, type SkillState, type TreeState } from "../../lib/skill-tree/progress";
import { SKILL_TREES, type SkillNode } from "../../lib/skill-tree/trees";
import "./skill-tree.css";

type LiveView = Extract<TrainingView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const SKILL_LABEL: Record<SkillState, string> = { locked: "Locked", available: "Ready", complete: "Done", expired: "Redo" };
const TREE_LABEL: Record<TreeState, string> = { locked: "Locked", available: "Ready to start", in_progress: "In progress", complete: "Complete" };
const TEAM = "__team__";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Skill trees: what each person can learn next, in order. Safety first (it opens every other
 * tree), then each skill unlocks after the one before it. Mentors (owners and admins) sign off a
 * skill for a whole session of people at once; everyone sees their own trees.
 */
export function SkillTreePanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const memberIds = useMemo(() => view.members.map((member) => member.userId), [view.members]);
  const model = useMemo(
    () => buildSkillTreeModel({ skills: view.skills, certifications: view.certifications, memberIds }),
    [view.skills, view.certifications, memberIds],
  );
  const isMember = memberIds.includes(view.viewerUserId);
  const [who, setWho] = useState<string>(view.canManage ? TEAM : view.viewerUserId);
  const [openTree, setOpenTree] = useState<string | null>(null);
  const [signing, setSigning] = useState<SkillNode | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (model.missing.length) {
    return view.canManage ? (
      <EmptyState
        compact
        title="Set up the skill trees"
        description={`Adds ${model.missing.length} skills in nine trees (Safety, Manufacturing, Design and CAD, Electrical, Programming, Drive team, Scouting, Pit crew, Leadership) to your team's training. Safety opens the rest.`}
      >
        <Button variant="primary" type="button" disabled={busy} onClick={() => void mutate({ action: "setup-skill-trees" })}>
          {busy ? "Setting up…" : "Set up skill trees"}
        </Button>
      </EmptyState>
    ) : (
      <EmptyState compact title="Skill trees aren't set up yet" description="An owner or admin sets them up once for the whole team." />
    );
  }

  const memberName = (id: string) => view.members.find((member) => member.userId === id)?.name || "Member";
  const showingTeam = who === TEAM;

  return (
    <section className="st-panel" aria-label="Skill trees">
      <div className="st-toolbar">
        {view.canManage ? (
          <label>
            Showing
            <select value={who} onChange={(event) => setWho(event.target.value)}>
              <option value={TEAM}>The whole team</option>
              {view.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userId === view.viewerUserId ? `${member.name || "You"} (you)` : member.name || member.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="app-muted">Your skills. A mentor signs you off as you learn each one.</p>
        )}
        {note ? <p className="st-note" role="status">{note}</p> : null}
      </div>

      <div className="st-trees">
        {SKILL_TREES.map((tree, index) => {
          const team = model.teamTrees[index]!;
          const mine = showingTeam ? null : model.memberTrees.get(who)?.[index];
          const pct = mine ? Math.round((mine.done / Math.max(1, mine.total)) * 100) : team.averagePct;
          return (
            <button
              key={tree.key}
              type="button"
              className={`st-tree${openTree === tree.key ? " is-open" : ""}${mine ? ` is-${mine.state}` : ""}`}
              aria-expanded={openTree === tree.key}
              onClick={() => setOpenTree((current) => (current === tree.key ? null : tree.key))}
            >
              <strong>{tree.title}</strong>
              <small>{team.skills} skills</small>
              <span className="st-bar" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
              <small>
                {mine
                  ? `${TREE_LABEL[mine.state]} · ${mine.done} of ${mine.total}`
                  : `Team average ${team.averagePct}% · ${team.finished} of ${team.members} finished`}
              </small>
            </button>
          );
        })}
      </div>

      {openTree ? (
        <TreeDetail
          treeKey={openTree}
          model={model}
          who={showingTeam ? (isMember ? view.viewerUserId : null) : who}
          whoName={showingTeam ? (isMember ? "You" : null) : memberName(who)}
          canManage={view.canManage}
          onSignOff={setSigning}
        />
      ) : null}

      {view.canManage && showingTeam ? <TeamMatrix model={model} members={view.members} /> : null}

      {signing ? (
        <SignOffDialog
          node={signing}
          model={model}
          members={view.members}
          busy={busy}
          onClose={() => setSigning(null)}
          onSubmit={async (memberUserIds, certifiedAt) => {
            const data = await mutate({ action: "sign-off-group", skillKey: signing.key, memberUserIds, certifiedAt });
            const result = (data?.signOff ?? null) as { signed: number; skipped: Array<{ memberUserId: string; reason: string }> } | null;
            if (result) {
              setNote(
                `${signing.title}: signed off ${result.signed}${result.skipped.length ? `, skipped ${result.skipped.length} (${result.skipped.map((row) => `${memberName(row.memberUserId)} — ${row.reason}`).slice(0, 2).join("; ")})` : ""}.`,
              );
              setSigning(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function TreeDetail({
  treeKey,
  model,
  who,
  whoName,
  canManage,
  onSignOff,
}: {
  treeKey: string;
  model: ReturnType<typeof buildSkillTreeModel>;
  who: string | null;
  whoName: string | null;
  canManage: boolean;
  onSignOff: (node: SkillNode) => void;
}) {
  const tree = SKILL_TREES.find((entry) => entry.key === treeKey)!;
  const states = who ? model.states.get(who) : null;
  return (
    <section className="st-detail app-card" aria-labelledby="st-detail-title">
      <header>
        <h2 id="st-detail-title">{tree.title}</h2>
        <p className="app-muted">
          {tree.summary}
          {whoName ? ` Showing ${whoName === "You" ? "your" : `${whoName}'s`} progress.` : ""}
        </p>
      </header>
      {tree.groups.map((group) => (
        <div key={group.title} className="st-group">
          <h3>{group.title}</h3>
          <ol>
            {group.nodes.map((def) => {
              const node = model.nodes.find((entry) => entry.key === `${tree.key}.${def.slug}`)!;
              const state = states?.get(node.key) ?? null;
              return (
                <li key={node.key} className={state ? `is-${state}` : undefined}>
                  <div>
                    <b>{node.title}</b>
                    <p>{node.blurb}</p>
                  </div>
                  {state ? <span className={`st-chip is-${state}`}>{SKILL_LABEL[state]}</span> : null}
                  {canManage ? (
                    <Button variant="secondary" size="sm" type="button" onClick={() => onSignOff(node)}>
                      Sign off…
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}

function SignOffDialog({
  node,
  model,
  members,
  busy,
  onClose,
  onSubmit,
}: {
  node: SkillNode;
  model: ReturnType<typeof buildSkillTreeModel>;
  members: LiveView["members"];
  busy: boolean;
  onClose: () => void;
  onSubmit: (memberUserIds: string[], certifiedAt: string) => Promise<void>;
}) {
  const ready = members.filter((member) => signOffBlocker(model, member.userId, node.key) === null);
  const notReady = members.length - ready.length;
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  // One batch signs off at most MAX_GROUP_SIGN_OFF people; a bigger session goes in two batches.
  const batch = Math.min(ready.length, MAX_GROUP_SIGN_OFF);
  const full = picked.length >= MAX_GROUP_SIGN_OFF;
  return (
    <Modal open onClose={onClose} title={`Sign off: ${node.title}`}>
      <p className="app-muted">
        Choose everyone who showed this skill (a whole training session at once).
        {notReady ? ` ${notReady} ${notReady === 1 ? "person isn't" : "people aren't"} listed: already done or still need an earlier skill.` : ""}
        {ready.length > MAX_GROUP_SIGN_OFF ? ` Up to ${MAX_GROUP_SIGN_OFF} at a time; sign off the rest in a second batch.` : ""}
      </p>
      {ready.length ? (
        <fieldset className="st-people">
          <legend className="sr-only">People</legend>
          <label className="check-field">
            <input
              type="checkbox"
              checked={picked.length === batch}
              onChange={(event) => setPicked(event.target.checked ? ready.slice(0, batch).map((member) => member.userId) : [])}
            />{" "}
            {ready.length > MAX_GROUP_SIGN_OFF ? `First ${batch} ready` : `Everyone ready (${ready.length})`}
          </label>
          {ready.map((member) => (
            <label key={member.userId} className="check-field">
              <input
                type="checkbox"
                disabled={full && !picked.includes(member.userId)}
                checked={picked.includes(member.userId)}
                onChange={(event) =>
                  setPicked((current) => (event.target.checked ? [...current, member.userId] : current.filter((id) => id !== member.userId)))
                }
              />{" "}
              {member.name || member.email}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>No one is ready for this skill right now.</p>
      )}
      <label className="st-date">
        Date
        <input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} />
      </label>
      <div className="st-actions">
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="button" disabled={busy || picked.length === 0 || !date} onClick={() => void onSubmit(picked, date)}>
          {busy ? "Signing off…" : `Sign off ${picked.length || ""}`.trim()}
        </Button>
      </div>
    </Modal>
  );
}

function TeamMatrix({ model, members }: { model: ReturnType<typeof buildSkillTreeModel>; members: LiveView["members"] }) {
  if (!members.length) return null;
  return (
    <section className="st-matrix app-card" aria-labelledby="st-matrix-title">
      <h2 id="st-matrix-title">Everyone</h2>
      <div className="st-matrix-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Member</th>
              {SKILL_TREES.map((tree) => (
                <th key={tree.key} scope="col">
                  {tree.title}
                </th>
              ))}
              <th scope="col">Overall</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const trees = model.memberTrees.get(member.userId) ?? [];
              const done = trees.reduce((sum, row) => sum + row.done, 0);
              const total = trees.reduce((sum, row) => sum + row.total, 0);
              return (
                <tr key={member.userId}>
                  <th scope="row">{member.name || member.email}</th>
                  {trees.map((row) => (
                    <td key={row.tree} className={`is-${row.state}`}>
                      {row.state === "locked" ? "—" : `${Math.round((row.done / Math.max(1, row.total)) * 100)}%`}
                    </td>
                  ))}
                  <td>{total ? `${Math.round((done / total) * 100)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
