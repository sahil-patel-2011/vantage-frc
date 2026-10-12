"use client";

import { useState } from "react";
import { Icon } from "../../components/icon";
import { Modal } from "../../components/ui";
import {
  AI_SKILL_GROUPS,
  aiSkillById,
  aiSkillsInGroup,
  type AiSkill,
} from "../../lib/ai-skills/catalog";

export type SkillAvailabilityRow = { id: string; available: boolean; reason: string | null };

/** Skill ids this member may pick (unknown availability = all, until the first load answers). */
function usable(availability: SkillAvailabilityRow[] | null): (skill: AiSkill) => boolean {
  if (!availability?.length) return () => true;
  const open = new Set(availability.filter((row) => row.available).map((row) => row.id));
  return (skill) => open.has(skill.id);
}

/**
 * The quiet "Using Sponsorships" chip above the message box. Tap to change the skill, × to let
 * Ask AI choose again. Nothing here is a primary action — Send is the only one.
 */
export function SkillChip({
  skillId,
  chosenBy,
  fromLabel,
  availability,
  onChange,
}: {
  skillId: string | null;
  /** How the shown skill was chosen: pinned by the person or the page, or picked for the last question. */
  chosenBy: "pinned" | "auto" | null;
  fromLabel: string | null;
  availability: SkillAvailabilityRow[] | null;
  onChange: (skillId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const skill = aiSkillById(skillId);
  const title = skill
    ? chosenBy === "auto"
      ? `Ask AI chose ${skill.name} for your last question. Tap to pick a different skill.`
      : `${skill.name}: ${skill.purpose} Tap to change.`
    : "Ask AI picks the right skill for each question. Tap to choose one yourself.";
  return (
    <div className="ask-skill" data-chosen-by={chosenBy ?? "none"}>
      <button
        type="button"
        className="ask-skill-chip"
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen(true)}
      >
        <Icon name="sparkles" />
        <span>{skill ? `Using ${skill.name}` : "Any skill"}</span>
        {skill && fromLabel ? <small>from {fromLabel}</small> : null}
      </button>
      {skill ? (
        <button
          type="button"
          className="ask-skill-clear"
          aria-label={`Stop using ${skill.name} and let Ask AI choose`}
          title="Let Ask AI choose"
          onClick={() => onChange(null)}
        >
          <Icon name="x" />
        </button>
      ) : null}
      <SkillPicker
        open={open}
        current={skill?.id ?? null}
        availability={availability}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** Every skill, grouped, in a sheet. "Let Ask AI choose" first. */
export function SkillPicker({
  open,
  current,
  availability,
  onClose,
  onPick,
}: {
  open: boolean;
  current: string | null;
  availability: SkillAvailabilityRow[] | null;
  onClose: () => void;
  onPick: (skillId: string | null) => void;
}) {
  const canUse = usable(availability);
  return (
    <Modal open={open} onClose={onClose} title="Skills" description="Ask AI picks one for you. Choose one to keep it for this chat." variant="sheet" className="ask-skill-sheet">
      <div className="ask-skill-list">
        <button type="button" className="ask-skill-option" aria-pressed={current === null} onClick={() => onPick(null)}>
          <strong>Let Ask AI choose</strong>
          <span>It picks the right skill for each question.</span>
        </button>
        {AI_SKILL_GROUPS.map((group) => {
          const skills = aiSkillsInGroup(group.id).filter(canUse);
          if (!skills.length) return null;
          return (
            <section key={group.id} className="ask-skill-group" aria-label={group.name}>
              <h3>{group.name}</h3>
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  className="ask-skill-option"
                  aria-pressed={current === skill.id}
                  onClick={() => onPick(skill.id)}
                >
                  <strong>{skill.name}</strong>
                  <span>{skill.purpose}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

/** One skill's starters as quiet chips. Tapping fills the box; it never sends. */
export function SkillStarters({ skillId, onPick }: { skillId: string; onPick: (text: string) => void }) {
  const skill = aiSkillById(skillId);
  if (!skill) return null;
  return (
    <div className="ask-starters" role="list" aria-label={`Things to ask ${skill.name}`}>
      {skill.starters.map((starter) => (
        <button key={starter} type="button" role="listitem" className="ask-starter" onClick={() => onPick(starter)}>
          {starter}
        </button>
      ))}
    </div>
  );
}

/**
 * The calm empty state: grouped skills, each with its first starters. Tapping one picks that
 * skill and fills the box.
 */
export function StarterGroups({
  availability,
  onPick,
}: {
  availability: SkillAvailabilityRow[] | null;
  onPick: (skillId: string, text: string) => void;
}) {
  const canUse = usable(availability);
  return (
    <div className="ask-groups">
      {AI_SKILL_GROUPS.map((group) => {
        const skills = aiSkillsInGroup(group.id).filter(canUse);
        if (!skills.length) return null;
        const lead = skills[0]!;
        const second = skills[1];
        const starters: Array<[AiSkill, string]> = [
          [lead, lead.starters[0]!],
          second ? [second, second.starters[0]!] : [lead, lead.starters[1] ?? lead.starters[0]!],
        ];
        return (
          <section key={group.id} className="ask-group" aria-label={group.name}>
            <h3>{group.name}</h3>
            <ul>
              {starters.map(([skill, text]) => (
                <li key={`${skill.id}-${text}`}>
                  <button type="button" className="ask-starter" onClick={() => onPick(skill.id, text)}>
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export type SkillPreview = {
  skill: string;
  status: "ok" | "empty" | "setup_required";
  summary: string;
  highlights: string[];
  next?: { label: string; href: string } | null;
};

/**
 * What a skill found in the team's records, computed without a model. Shown under an answer as
 * "What I looked at", and on its own when AI is off or over its limit.
 */
export function SkillPreviewCard({ preview, lead }: { preview: SkillPreview; lead?: string }) {
  const skill = aiSkillById(preview.skill);
  return (
    <section className={`ask-preview status-${preview.status}`} aria-label={`${skill?.name ?? "Skill"} from your records`}>
      <span className="eyebrow">{lead ?? `${skill?.name ?? "Skill"} · from your records`}</span>
      <p className="ask-preview-summary">{preview.summary}</p>
      {preview.highlights.length ? (
        <ul>
          {preview.highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {preview.next ? (
        <a className="ask-preview-next" href={preview.next.href}>
          {preview.next.label} →
        </a>
      ) : null}
    </section>
  );
}
