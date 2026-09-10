"use client";

import { useEffect, useState } from "react";
import type { SchemaDefinition } from "@vantage/scouting";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  normalizeRobotImageRefs,
} from "@vantage/scouting";
import { FormRow } from "../../components/ui";
import { useOnline } from "../../lib/offline/use-online";
import { getQueuedMediaBlob } from "../../lib/scout-offline";
import { resolveScoutMediaPreview } from "../../lib/scouting/scout-media-preview";
import { StudioField, isStudioField } from "./studio-fields";
import type { OfficialFlag } from "./scouting-model";

/**
 * Offline-first photo preview: the queued IndexedDB blob when we have it.
 * Offline with no blob is missing — never a server URL that 404s as a broken
 * image, never a DEMO/placeholder jpeg.
 */
export function RobotImagePreview({ clientId, orgId }: { clientId: string; orgId: string }) {
  const online = useOnline();
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [hasBlob, setHasBlob] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const blob = await getQueuedMediaBlob(clientId).catch(() => null);
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setLocalUrl(objectUrl);
        setHasBlob(true);
      } else {
        setLocalUrl(null);
        setHasBlob(false);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId]);
  if (!ready) return <span className="app-muted">Loading photo…</span>;
  const preview = resolveScoutMediaPreview({
    orgId,
    clientId,
    hasLocalBlob: hasBlob,
    online,
    uploaded: !hasBlob && online,
    hasRemoteThumb: false,
  });
  if (preview.status === "local" && localUrl) {
    return <img src={localUrl} alt="Robot" width={72} height={72} />;
  }
  if (preview.status === "remote" && preview.src) {
    return <img src={preview.src} alt="Robot" width={72} height={72} />;
  }
  return (
    <span className="app-muted">
      {preview.status === "missing" ? preview.reason : "This photo is not available."}
    </span>
  );
}

export function Field({
  field,
  value,
  flags,
  historyHint,
  disagreementRate,
  orgId,
  onChange,
  onAttachRobotImage,
}: {
  field: SchemaDefinition["fields"][number];
  value: unknown;
  flags: OfficialFlag[];
  historyHint: string | null;
  disagreementRate: number | null;
  orgId?: string;
  onChange(value: unknown): void;
  onAttachRobotImage?: (file: File) => Promise<string | null>;
}) {
  const conflict = flags.find((flag) => flag.status === "conflict");
  const soft = flags.find((flag) => flag.soft);
  const liveHint = conflict?.detail ?? soft?.detail;
  const historyWarn = (disagreementRate ?? 0) >= 0.18;
  const tone = conflict
    ? "conflict"
    : soft
      ? "soft"
      : flags.some((flag) => flag.status === "match")
        ? "match"
        : historyWarn
          ? "history-warn"
          : undefined;
  const label = `${field.label}${field.required ? " *" : ""}`;
  const isMc =
    field.widget === "mc" ||
    field.type === "multiple_choice";

  async function attachFiles(files: FileList | null) {
    if (!files?.length || !onAttachRobotImage) return;
    const refs = normalizeRobotImageRefs(value);
    const next = [...refs];
    for (const file of Array.from(files)) {
      const clientId = await onAttachRobotImage(file);
      if (clientId) next.push(clientId);
    }
    onChange(next);
  }

  const body = (() => {
    // Studio types first — they own their own label/readout chrome, so they must
    // not fall through into the legacy FormRow renderers below.
    if (isStudioField(field)) {
      return <StudioField field={field} value={value} onChange={onChange} label={label} />;
    }
    if (field.type === "boolean" || field.widget === "yesno") {
      return (
        <label className="soft-form-row check-field">
          <span className="app-muted">{label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        </label>
      );
    }
    if (field.type === "drivetrain_type" || field.widget === "drivetrain") {
      const options =
        field.options?.length ? field.options : [...DEFAULT_DRIVETRAIN_OPTIONS];
      return (
        <FormRow label={label} hint={field.helpText ?? "Select the robot drivetrain"}>
          <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select drivetrain…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </FormRow>
      );
    }
    if (field.type === "robot_image" || field.widget === "robot_image") {
      const refs = normalizeRobotImageRefs(value);
      return (
        <FormRow
          label={label}
          hint={field.helpText ?? "Camera or gallery — stored only for this organization"}
        >
          <div className="scout-robot-images">
            {refs.length ? (
              <ul className="scout-robot-image-list">
                {refs.map((ref) => (
                  <li key={ref}>
                    {orgId ? (
                      <RobotImagePreview clientId={ref} orgId={orgId} />
                    ) : (
                      <span className="app-muted">{ref.slice(0, 8)}…</span>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        onChange(refs.filter((item) => item !== ref).length ? refs.filter((item) => item !== ref) : undefined)
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="scout-robot-image-actions">
              <label className="scout-media scout-robot-capture">
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    void attachFiles(event.target.files).then(() => {
                      event.target.value = "";
                    });
                  }}
                />
              </label>
              <label className="scout-media scout-robot-capture">
                Gallery
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    void attachFiles(event.target.files).then(() => {
                      event.target.value = "";
                    });
                  }}
                />
              </label>
            </div>
            <small className="app-muted">Works offline — photos queue on this device until sync.</small>
          </div>
        </FormRow>
      );
    }
    if (isMc) {
      return (
        <FormRow label={label} hint={field.helpText}>
          <div className="scout-mc-row" role="radiogroup" aria-label={field.label}>
            {(field.options ?? []).map((option) => (
              <label key={option} className="scout-mc-option">
                <input
                  type="radio"
                  name={field.key}
                  checked={String(value ?? "") === option}
                  onChange={() => onChange(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </FormRow>
      );
    }
    if (
      field.type === "select" ||
      field.type === "dropdown" ||
      field.type === "multiple_choice"
    ) {
      return (
        <FormRow label={label} hint={field.helpText}>
          <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select…</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </FormRow>
      );
    }
    if (field.widget === "free" || field.type === "long_text") {
      return (
        <FormRow label={label} hint={field.helpText ?? "Long-form notes"}>
          <textarea
            value={String(value ?? "")}
            required={field.required}
            placeholder="Notes…"
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    }
    if (field.widget === "short" || field.type === "short_answer" || field.type === "text") {
      return (
        <FormRow label={label} hint={field.helpText ?? "Short answer"}>
          <input
            type="text"
            value={String(value ?? "")}
            required={field.required}
            placeholder="Short answer"
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    }
    return (
      <FormRow label={label} hint={field.helpText}>
        <input
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          required={field.required}
          onChange={(event) =>
            onChange(field.type === "number" ? event.target.valueAsNumber : event.target.value)
          }
        />
      </FormRow>
    );
  })();
  return (
    <div className={`scout-field-wrap${tone ? ` is-${tone}` : ""}`}>
      {body}
      {liveHint ? (
        <p className={`scout-field-flag ${tone ?? ""}`} role="status">
          {liveHint}
        </p>
      ) : null}
      {historyHint ? (
        <p className={`scout-field-trust ${historyWarn ? "warn" : "ok"}`} role="status">
          {historyHint}
        </p>
      ) : null}
    </div>
  );
}
