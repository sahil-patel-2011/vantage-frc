"use client";

import { useEffect, useState } from "react";

type FreebuffModel = { id: string; slug: string; label: string; note?: string; metered?: boolean };

/**
 * Compact picker for Freebuff models. DeepSeek V4 Flash is first — free,
 * unlimited, and fast. Saves through team funding prefs, not per-message.
 */
export function FreebuffModelPicker({ orgId }: { orgId: string }) {
  const [models, setModels] = useState<FreebuffModel[]>([]);
  const [value, setValue] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/team/ai-funding?orgId=${encodeURIComponent(orgId)}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          grants?: Array<{ accessKind: string }>;
          canManage?: boolean;
          freebuffModel?: string;
          freebuffModels?: FreebuffModel[];
          usePlatformFreeAi?: boolean;
        };
        if (cancelled) return;
        const relay = data.grants?.some((grant) => grant.accessKind === "platform_relay");
        const catalog = data.freebuffModels ?? [];
        if (!relay || data.usePlatformFreeAi === false || catalog.length === 0) {
          setVisible(false);
          return;
        }
        setModels(catalog);
        setValue(data.freebuffModel ?? catalog[0]!.slug);
        setCanManage(data.canManage === true);
        setVisible(true);
      } catch {
        // Chat still works without a picker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!visible || models.length === 0) return null;

  async function save(next: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/team/ai-funding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, usePlatformFreeAi: true, freebuffModel: next }),
      });
      if (response.ok) setValue(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="ch-model-picker">
      Free AI model
      <select
        aria-label="Free AI model"
        value={value}
        disabled={!canManage || saving}
        onChange={(event) => void save(event.target.value)}
      >
        {models.map((option) => (
          <option key={option.slug} value={option.slug}>
            {option.metered
              ? `${option.label} (metered)`
              : option.note
                ? `${option.label} — ${option.note}`
                : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
