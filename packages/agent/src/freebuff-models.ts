/**
 * FreeBuff models Vantage will send to the Pi.
 *
 * The picker can include metered slugs (DeepSeek V4 Flash) when the operator
 * chooses them. Those are labeled metered. Unknown slugs still clamp to GLM.
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

/** Explicit picker entries. Metered slugs are labeled — they are not "free forever". */
export const FREEBUFF_SELECTABLE_MODELS: readonly FreebuffSelectableModel[] = [
  {
    id: "glm-5.3-flash",
    slug: "glm/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    aliases: ["glm/glm-5.3-flash", "z-ai/glm-5.3-flash", "glm-5.3-flash", "glm-5.3-flash-free", "flash"],
    metered: false,
    note: "Unmetered — no daily session.",
  },
  {
    id: "mimo-2.5",
    slug: "mimo/mimo-2.5",
    label: "MiMo 2.5",
    aliases: ["mimo/mimo-2.5", "mimo/mimo-v2.5", "mimo-2.5", "mimo-2.5-free", "mimo"],
    metered: false,
    note: "Unmetered — no daily session.",
  },
  {
    id: "deepseek-v4-flash",
    slug: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    aliases: [
      "deepseek/deepseek-v4-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash-0731",
    ],
    metered: true,
    note: "Metered — uses daily sessions and can pause at peak hours.",
  },
];

export const FREEBUFF_UNMETERED_MODELS: readonly FreebuffUnmeteredModel[] =
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

/**
 * Always returns one of the two unmetered slugs. A metered or unknown request
 * becomes the default rather than being forwarded — that is what keeps DeepSeek
 * V4 Flash off the wire even if someone set FREE_RELAY_MODEL to it.
 */
export function resolveUnmeteredFreebuffModel(requested?: string | null): string {
  return canonicalizeFreebuffModel(requested) ?? FREEBUFF_UNMETERED_DEFAULT;
}

/** Forwards an explicit picker choice (including metered). Unknown slugs become GLM. */
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

export function freebuffModelCatalog(): Array<{ id: string; slug: string; label: string }> {
  return FREEBUFF_UNMETERED_MODELS.map((model) => ({
    id: model.id,
    slug: model.slug,
    label: model.label,
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
