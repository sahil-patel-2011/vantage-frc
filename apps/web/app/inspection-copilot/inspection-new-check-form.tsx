"use client";

import { useMemo, useState } from "react";
import { Panel, Button } from "../../components/ui";
import {
  InspectionCheckFieldset,
  InspectionFrameMeasures,
  InspectionIdentityFields,
  InspectionWeightRows,
  InspectionWiringMeasures,
} from "./inspection-form-sections";
import {
  INSPECTION_CHECK_SECTIONS,
  INITIAL_INSPECTION_FORM,
  buildLogCheckPayload,
  canSubmitInspectionCheck,
  type InspectionCheckKey,
  type InspectionFormState,
  type InspectionMeasureKey,
} from "./inspection-new-check-model";

export function NewCheckForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState<InspectionFormState>(INITIAL_INSPECTION_FORM);
  const canSubmit = useMemo(() => canSubmitInspectionCheck(form), [form]);

  const setRobotName = (value: string) => setForm((prev) => ({ ...prev, robotName: value }));
  const setMeasure = (key: InspectionMeasureKey, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const setCheck = (key: InspectionCheckKey, checked: boolean) =>
    setForm((prev) => ({ ...prev, [key]: checked }));

  return (
    <Panel
      id="inspection-copilot-form"
      as="form"
      className="inspection-copilot-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        mutate(buildLogCheckPayload(form));
        setForm(INITIAL_INSPECTION_FORM);
      }}
    >
      <h2 style={{ margin: 0 }}>Run an inspection-readiness check</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Enter real manual limits and measured robot values — predictions stay blank until you submit.
      </p>
      <InspectionIdentityFields form={form} onRobotName={setRobotName} onMeasure={setMeasure} />
      <InspectionWeightRows
        items={form.weightItems}
        onChange={(weightItems) => setForm((prev) => ({ ...prev, weightItems }))}
      />
      <div>
        <InspectionFrameMeasures form={form} onMeasure={setMeasure} />
        <InspectionCheckFieldset
          section={INSPECTION_CHECK_SECTIONS.find((section) => section.id === "bumpers")!}
          form={form}
          hideTitle
          onToggle={setCheck}
        />
      </div>
      <div>
        <InspectionWiringMeasures form={form} onMeasure={setMeasure} />
        <InspectionCheckFieldset
          section={INSPECTION_CHECK_SECTIONS.find((section) => section.id === "wiring")!}
          form={form}
          hideTitle
          onToggle={setCheck}
        />
      </div>
      {INSPECTION_CHECK_SECTIONS.filter(
        (section) => section.id !== "bumpers" && section.id !== "wiring",
      ).map((section) => (
        <InspectionCheckFieldset
          key={section.id}
          section={section}
          form={form}
          onToggle={setCheck}
        />
      ))}
      <div>
        <Button variant="primary" type="submit" disabled={busy || !canSubmit}>
          Predict inspection failures
        </Button>
      </div>
    </Panel>
  );
}
