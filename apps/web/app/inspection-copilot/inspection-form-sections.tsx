"use client";

import { Button, FormGrid, FormRow } from "../../components/ui";
import {
  stale120PerimeterCue,
  stale16ExtensionCue,
  staleBumperThicknessCue,
  staleBumperZoneCue,
} from "../../lib/inspection-copilot";
import {
  FRAME_MEASURE_FIELDS,
  WEIGHT_LIMIT_FIELD_LABEL,
  WIRING_MEASURE_FIELDS,
  emptyWeightRow,
  setWeightField,
  type InspectionCheckKey,
  type InspectionCheckSection,
  type InspectionFormState,
  type InspectionMeasureKey,
  type WeightItemDraft,
} from "./inspection-new-check-model";

export function InspectionIdentityFields({
  form,
  onRobotName,
  onMeasure,
}: {
  form: InspectionFormState;
  onRobotName: (value: string) => void;
  onMeasure: (key: InspectionMeasureKey, value: string) => void;
}) {
  return (
    <FormGrid min={200}>
      <FormRow label="Robot name">
        <input
          value={form.robotName}
          onChange={(event) => onRobotName(event.target.value)}
          placeholder="2026 Competition Bot"
          required
        />
      </FormRow>
      <FormRow label={WEIGHT_LIMIT_FIELD_LABEL}>
        <input
          type="number"
          min={0}
          value={form.weightLimitLbs}
          onChange={(event) => onMeasure("weightLimitLbs", event.target.value)}
        />
      </FormRow>
    </FormGrid>
  );
}

export function InspectionWeightRows({
  items,
  onChange,
}: {
  items: WeightItemDraft[];
  onChange: (next: WeightItemDraft[]) => void;
}) {
  return (
    <div>
      <strong className="app-muted">Weight budget (itemized weigh-in)</strong>
      <div className="inspection-copilot-weight-rows">
        {items.map((row, index) => (
          <div key={index} className="inspection-copilot-weight-row">
            <input
              placeholder="Component (e.g. Chassis)"
              value={row.name}
              onChange={(event) => onChange(setWeightField(items, index, "name", event.target.value))}
            />
            <input
              type="number"
              min={0}
              placeholder="Weight (lbs)"
              value={row.weightLbs}
              onChange={(event) =>
                onChange(setWeightField(items, index, "weightLbs", event.target.value))
              }
            />
            <button
              type="button"
              className="text-button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              disabled={items.length <= 1}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...items, emptyWeightRow()])}
      >
        Add weight item
      </Button>
    </div>
  );
}

export function InspectionFrameMeasures({
  form,
  onMeasure,
}: {
  form: InspectionFormState;
  onMeasure: (key: InspectionMeasureKey, value: string) => void;
}) {
  const cues = [
    stale120PerimeterCue(Number(form.perimeterLimitIn)),
    staleBumperZoneCue(Number(form.bumperMaxHeightIn)),
    staleBumperThicknessCue(Number(form.bumperMinThicknessIn)),
    stale16ExtensionCue(Number(form.extensionLimitIn)),
  ].filter((cue): cue is string => Boolean(cue));
  return (
    <>
      <strong className="app-muted">Frame / bumper limits vs measured</strong>
      {cues.map((cue) => (
        <p key={cue} className="app-muted" role="status">
          {cue}
        </p>
      ))}
      <FormGrid min={180}>
        {FRAME_MEASURE_FIELDS.map((field) => (
          <FormRow key={field.key} label={field.label}>
            <input
              type="number"
              min={0}
              value={form[field.key]}
              onChange={(event) => onMeasure(field.key, event.target.value)}
            />
          </FormRow>
        ))}
      </FormGrid>
    </>
  );
}

export function InspectionWiringMeasures({
  form,
  onMeasure,
}: {
  form: InspectionFormState;
  onMeasure: (key: InspectionMeasureKey, value: string) => void;
}) {
  return (
    <>
      <strong className="app-muted">Wiring / power limits vs installed</strong>
      <FormGrid min={180}>
        {WIRING_MEASURE_FIELDS.map((field) => (
          <FormRow key={field.key} label={field.label}>
            <input
              type="number"
              min={0}
              value={form[field.key]}
              onChange={(event) => onMeasure(field.key, event.target.value)}
            />
          </FormRow>
        ))}
      </FormGrid>
    </>
  );
}

export function InspectionCheckFieldset({
  section,
  form,
  hideTitle,
  onToggle,
}: {
  section: InspectionCheckSection;
  form: InspectionFormState;
  hideTitle?: boolean;
  onToggle: (key: InspectionCheckKey, checked: boolean) => void;
}) {
  const gated = section.gate ? form[section.gate] : true;
  return (
    <div>
      {hideTitle ? null : <strong className="app-muted">{section.title}</strong>}
      {section.hint ? <p className="app-muted">{section.hint}</p> : null}
      <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
        {section.items.map((item) => {
          if (section.gate && item.key !== section.gate && !gated) return null;
          return (
            <label key={item.key}>
              <input
                type="checkbox"
                checked={form[item.key]}
                onChange={(event) => onToggle(item.key, event.target.checked)}
              />
              {item.label}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
