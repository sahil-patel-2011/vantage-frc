/**
 * FreeBuff models Vantage will send to the Pi.
 *
 * DeepSeek V4 Flash is first: free, unlimited, and the fast routing default.
 * Unknown slugs clamp to that default rather than being forwarded.
 */

export type FreebuffUnmeteredModel = {
  id: string;
  slug: string;
  label: string;
  aliases: readonly string[];
};

export type FreebuffSelectableModel = FreebuffUnmeteredModel & {
  metered: boolean;
  note: string;
};

/** Picker entries. DeepSeek V4 Flash is the free / unlimited / fast default. */
export const FREEBUFF_SELECTABLE_MODELS: readonly FreebuffSelectableModel[] = [
  {
    id: "deepseek-v4-flash",
    slug: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    aliases: [
      "deepseek/deepseek-v4-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash-0731",
      "deepseek",
    ],
    metered: false,
    note: "Free, unlimited, and fast request routing.",
  },
  {
    id: "glm-5.3-flash",
    slug: "glm/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    aliases: ["glm/glm-5.3-flash", "z-ai/glm-5.3-flash", "glm-5.3-flash", "glm-5.3-flash-free", "flash"],
    metered: false,
    note: "Free and unmetered.",
  },
  {
    id: "mimo-2.5",
    slug: "mimo/mimo-2.5",
    label: "MiMo 2.5",
    aliases: ["mimo/mimo-2.5", "mimo/mimo-v2.5", "mimo-2.5", "mimo-2.5-free", "mimo"],
    metered: false,
    note: "Free and unmetered.",
  },
];

export const FREEBUFF_UNMETERED_MODELS: readonly FreebuffSelectableModel[] =
  FREEBUFF_SELECTABLE_MODELS.filter((model) => !model.metered);

export const FREEBUFF_UNMETERED_DEFAULT = FREEBUFF_UNMETERED_MODELS[0]!.slug;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function canonicalizeFreebuffModel(requested: string | null | undefined): string | null {
  return matchFreebuffModel(requested, FREEBUFF_UNMETERED_MODELS);
}

export function canonicalizeSelectableFreebuffModel(
  requested: string | null | undefined,
): string | null {
  return matchFreebuffModel(requested, FREEBUFF_SELECTABLE_MODELS);
}

function matchFreebuffModel(
  requested: string | null | undefined,
  catalog: readonly FreebuffUnmeteredModel[],
): string | null {
  if (!requested?.trim()) return null;
  const key = normalize(requested);
  for (const model of catalog) {
    if (normalize(model.slug) === key || normalize(model.id) === key) return model.slug;
    if (model.aliases.some((alias) => normalize(alias) === key)) return model.slug;
  }
  return null;
}

/** Always returns a picker slug. Unknown requests become DeepSeek V4 Flash. */
export function resolveUnmeteredFreebuffModel(requested?: string | null): string {
  return canonicalizeFreebuffModel(requested) ?? FREEBUFF_UNMETERED_DEFAULT;
}

/** Forwards an explicit picker choice. Unknown slugs become DeepSeek V4 Flash. */
export function resolveSelectableFreebuffModel(requested?: string | null): string {
  return canonicalizeSelectableFreebuffModel(requested) ?? FREEBUFF_UNMETERED_DEFAULT;
}

export function isMeteredFreebuffModel(requested: string | null | undefined): boolean {
  const slug = canonicalizeSelectableFreebuffModel(requested);
  return FREEBUFF_SELECTABLE_MODELS.some((model) => model.slug === slug && model.metered);
}

export function isUnmeteredFreebuffModel(requested: string | null | undefined): boolean {
  return canonicalizeFreebuffModel(requested) !== null;
}

export function freebuffPickerLabel(model: {
  label: string;
  note?: string;
  metered?: boolean;
}): string {
  if (model.metered) return `${model.label} (metered)`;
  return model.note ? `${model.label} — ${model.note}` : model.label;
}

export function freebuffModelCatalog(): Array<{
  id: string;
  slug: string;
  label: string;
  metered: boolean;
  note: string;
}> {
  return FREEBUFF_UNMETERED_MODELS.map((model) => ({
    id: model.id,
    slug: model.slug,
    label: model.label,
    metered: model.metered,
    note: model.note,
  }));
}

export function freebuffSelectableCatalog(): Array<{
  id: string;
  slug: string;
  label: string;
  metered: boolean;
  note: string;
}> {
  return FREEBUFF_SELECTABLE_MODELS.map((model) => ({
    id: model.id,
    slug: model.slug,
    label: model.label,
    metered: model.metered,
    note: model.note,
  }));
}
