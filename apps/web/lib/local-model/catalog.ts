/**
 * Small models that run on the person's own machine.
 *
 * The point is not to replace the hosted models. It is that a lot of what
 * Vantage does with a model is small, private, and constant: deciding which of
 * forty saved notes is relevant to what you just typed, summarising a match so
 * the next screen can open fast, keeping a thread's context tidy. Sending that
 * to a datacentre costs money, costs a round trip, and sends a team's notes
 * somewhere they did not have to go.
 *
 * At roughly a billion parameters a model is not going to write your impact
 * essay. It is good enough to rank, summarise, extract and route, and those are
 * exactly the jobs that happen constantly.
 *
 * Licence is a first-class column here, not a footnote. Vantage is commercial
 * and multi-tenant, and a model whose licence restricts that is not a candidate
 * however well it scores.
 */

export type LocalModel = {
  id: string;
  label: string;
  /** Parameter count, for the person deciding whether to allow the download. */
  parameters: string;
  /** Approximate download in megabytes, quantised. */
  downloadMb: number;
  /** Rough working memory needed once loaded, in megabytes. */
  runtimeMb: number;
  licence: string;
  /** True when the licence is a plain permissive one with no field-of-use terms. */
  permissive: boolean;
  /** Why this one is in the list, in the words of the tradeoff it makes. */
  rationale: string;
};

/**
 * Ordered best-quality first.
 *
 * Qwen leads on licence as much as on quality: Apache-2.0 has no field-of-use
 * restrictions and no user-count trigger, which for a product schools pay for
 * is worth more than a couple of benchmark points. The Llama entry is the
 * smaller, faster fallback for machines that cannot hold the first one.
 */
export const LOCAL_MODELS: readonly LocalModel[] = [
  {
    id: "qwen2.5-1.5b-instruct-q4f16",
    label: "Qwen2.5 1.5B Instruct",
    parameters: "1.5B",
    downloadMb: 1_100,
    runtimeMb: 1_800,
    licence: "Apache-2.0",
    permissive: true,
    rationale:
      "The best answers available at this size, and a licence with no restrictions on commercial or multi-tenant use. Needs a little more memory than the alternative.",
  },
  {
    id: "llama-3.2-1b-instruct-q4f16",
    label: "Llama 3.2 1B Instruct",
    parameters: "1B",
    downloadMb: 720,
    runtimeMb: 1_200,
    licence: "Llama 3.2 Community Licence",
    permissive: false,
    rationale:
      "Smaller and quicker to load, for machines that cannot hold the larger one. Its licence carries conditions, so it is the fallback rather than the default.",
  },
] as const;

export const DEFAULT_LOCAL_MODEL_ID = LOCAL_MODELS[0]!.id;

export function localModelById(id: string | null | undefined): LocalModel | null {
  if (!id) return null;
  return LOCAL_MODELS.find((model) => model.id === id) ?? null;
}

/**
 * The best model this machine can actually hold.
 *
 * Picks on runtime memory rather than download size, because the download is a
 * one-off annoyance and running out of memory mid-answer is a crash. Returns
 * null when nothing in the list fits, which is a real answer: a machine that
 * cannot run the smallest one should be told so, not handed the smallest one
 * and left to discover it.
 */
export function bestModelForMemory(availableMb: number | null): LocalModel | null {
  if (availableMb == null || !Number.isFinite(availableMb)) {
    // Memory unknown. The conservative pick is the smaller model, because being
    // wrong the other way means a crash.
    return LOCAL_MODELS[LOCAL_MODELS.length - 1] ?? null;
  }
  // Leave half the reported memory for the browser, the page, and everything
  // else the person has open. A model that fits only on an empty machine does
  // not fit.
  const budget = availableMb / 2;
  return LOCAL_MODELS.find((model) => model.runtimeMb <= budget) ?? null;
}

/** "1.1 GB" — for the sentence that asks permission to download it. */
export function humanSize(megabytes: number): string {
  if (megabytes < 1_000) return `${Math.round(megabytes)} MB`;
  return `${(megabytes / 1_000).toFixed(1)} GB`;
}
