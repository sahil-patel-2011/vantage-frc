"use client";
import { FormRow } from "../../../components/ui";
import type { DraftQuestion } from "../../../lib/scouting/form-builder";

export function CollectionSettings({ question, index, match, disabled, onChange }: { question: DraftQuestion; index: number; match: boolean; disabled: boolean; onChange: (collectionConfig: Record<string, unknown>) => void }) {
  const config = question.collectionConfig ?? {};
  return <>
    {match ? <FormRow label="Match section" hint="Choose when this question appears while the clock runs. Every answer remains available in Review.">
      <select aria-label={`Match section for question ${index + 1}`} disabled={disabled} value={typeof config.scoutPhase === "string" ? config.scoutPhase : ""} onChange={event => onChange({ ...config, scoutPhase: event.target.value || undefined })}>
        <option value="">Detect from question</option><option value="pre">Before the match</option><option value="auto">Autonomous</option><option value="teleop">Teleop</option><option value="endgame">Endgame</option><option value="review">Review</option>
      </select>
    </FormRow> : null}
    {question.kind === "number" ? <label className="sfb-check"><input type="checkbox" disabled={disabled} checked={config.requireObservation === true} onChange={event => onChange({ ...config, requireObservation: event.target.checked || undefined })} />Keep untouched counts blank</label> : null}
  </>;
}
