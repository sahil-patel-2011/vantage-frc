"use client";

// Subsystem picker for inventory items: a select over the org's robot_subsystems (0104) via
// the existing /api/subsystems, replacing the free-text field so BOM lines, FMEA cadence and
// the spare forecast can match on one spelling. Falls back to text entry only when the org
// has not defined any subsystems yet (and says so), and keeps a legacy free-text value
// selectable so editing an old item never silently drops it.

import { useEffect, useState } from "react";

type SubsystemOption = { id: string; name: string };

const cache = new Map<string, Promise<SubsystemOption[]>>();

async function loadSubsystems(orgId: string): Promise<SubsystemOption[]> {
  const cached = cache.get(orgId);
  if (cached) return cached;
  const request = fetch(`/api/subsystems?orgId=${encodeURIComponent(orgId)}`)
    .then(async (response) => {
      const data = (await response.json()) as { status?: string; subsystems?: SubsystemOption[] };
      if (!response.ok || data.status !== "ready") return [];
      return (data.subsystems ?? []).map((row) => ({ id: row.id, name: row.name }));
    })
    .catch(() => [] as SubsystemOption[]);
  cache.set(orgId, request);
  return request;
}

export function SubsystemSelect({
  orgId,
  value,
  onChange,
  disabled,
}: {
  orgId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<SubsystemOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setOptions([]);
      return;
    }
    void loadSubsystems(orgId).then((rows) => {
      if (!cancelled) setOptions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (options === null) {
    return <input value={value} disabled placeholder="Loading subsystems…" readOnly />;
  }

  if (options.length === 0) {
    return (
      <>
        <input value={value} disabled={disabled} placeholder="No subsystems defined yet" onChange={(e) => onChange(e.target.value)} />
        <small className="app-muted">
          Define subsystems on <a href={`/subsystems?orgId=${encodeURIComponent(orgId)}`}>Subsystem specs</a> to pick from a list.
        </small>
      </>
    );
  }

  const names = new Set(options.map((option) => option.name));
  const legacy = value && !names.has(value) ? value : null;

  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {legacy ? <option value={legacy}>{legacy} (not in Subsystem specs)</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.name}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
