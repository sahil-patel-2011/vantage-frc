"use client";

import { memo, useCallback, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { Field } from "./scouting-field";

type Props = Omit<ComponentProps<typeof Field>, "onChange" | "onAttachRobotImage"> & {
  setPayload: Dispatch<SetStateAction<Record<string, unknown>>>;
  attachMedia?: (file: File, options: { fieldKey: string; tags: string[] }) => Promise<string | null>;
};

/** A counter tap updates its answer without redrawing every other field widget. */
export const ScoutingAnswerField = memo(function ScoutingAnswerField({ setPayload, attachMedia, ...props }: Props) {
  const key = props.field.key;
  const onChange = useCallback((value: unknown) => setPayload(current => ({ ...current, [key]: value })), [key, setPayload]);
  const onAttach = useCallback((file: File) => attachMedia ? attachMedia(file, { fieldKey: key, tags: ["robot"] }) : Promise.resolve(null), [attachMedia, key]);
  return <Field {...props} onChange={onChange} onAttachRobotImage={attachMedia ? onAttach : undefined} />;
});
