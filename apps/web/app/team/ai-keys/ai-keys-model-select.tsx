"use client";

import { useId, useState } from "react";
import type { ModelOption } from "./ai-keys-model";

/** Models every OpenRouter key can use without picking one. */
const OPENROUTER_CHOICES = [{ modelId: "openrouter/free", label: "Free models (OpenRouter picks one)" }];

const OTHER = "__other__";

/** The models a provider's key can run, from the app's catalog; effort variants are one entry. */
export function modelChoicesFor(provider: string, options: readonly ModelOption[]): { modelId: string; label: string }[] {
  if (provider === "openrouter") return OPENROUTER_CHOICES;
  const seen = new Set<string>();
  return options
    .filter((option) => option.provider === provider && !option.fixedOnly)
    .filter((option) => (seen.has(option.modelId) ? false : (seen.add(option.modelId), true)))
    .map((option) => ({ modelId: option.modelId, label: option.label }));
}

/**
 * Model as a menu, not a text box: Automatic (the team's routing picks), then the models this
 * provider's key can run. A custom endpoint (Groq, Ollama, LM Studio) can name its own model
 * under "Other model…", since only that server knows its list.
 */
export function ModelSelect({
  provider,
  value,
  onChange,
  options,
  customEndpoint = false,
  disabled = false,
  label = "Model",
}: {
  provider: string;
  value: string;
  onChange: (model: string) => void;
  options: readonly ModelOption[];
  customEndpoint?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const choices = customEndpoint ? [] : modelChoicesFor(provider, options);
  const first = value.split(",")[0]?.trim() ?? "";
  const known = !first || choices.some((choice) => choice.modelId === first);
  const [typing, setTyping] = useState(!known);
  const selectValue = typing ? OTHER : first;
  return (
    <div className="ai-keys-model-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={selectValue}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OTHER) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(next);
        }}
      >
        <option value="">Automatic (recommended)</option>
        {choices.map((choice) => (
          <option key={choice.modelId} value={choice.modelId}>
            {choice.label}
          </option>
        ))}
        {customEndpoint || !known ? <option value={OTHER}>Other model…</option> : null}
      </select>
      {typing ? (
        <input
          type="text"
          aria-label={`${label} name`}
          value={first}
          disabled={disabled}
          spellCheck={false}
          placeholder="The model name your server uses"
          onChange={(event) => onChange(event.target.value.trim())}
        />
      ) : null}
    </div>
  );
}
