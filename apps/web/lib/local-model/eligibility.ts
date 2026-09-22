/**
 * Whether this machine, right now, should fetch a model.
 *
 * The setting is on by default. This module is why that is defensible: "on"
 * means the feature is wanted, not that a gigabyte should leave the network the
 * instant a phone opens the page in the stands. The download waits for a
 * machine that can run it and a connection that will not be hurt by it, and it
 * asks once before the first one.
 *
 * Every check answers with a sentence a person can act on. "Not supported" is
 * not an answer; "this browser has no GPU access, so the model would take
 * minutes per reply" tells someone what to do about it.
 *
 * Pure and deterministic: the environment comes in as an argument, so every
 * branch is testable without a browser.
 */

import { bestModelForMemory, humanSize, type LocalModel } from "./catalog";

export type DeviceProfile = {
  /** Whether the browser exposes WebGPU. Without it this is unusably slow. */
  webgpu: boolean;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  memoryGb: number | null;
  /** Bytes still available to this origin, from the storage estimate. */
  storageFreeBytes: number | null;
  /** The person asked their browser or OS to use less data. */
  saveData: boolean;
  /** "slow-2g" | "2g" | "3g" | "4g", when reported. */
  connection: string | null;
  /** True when the browser says the connection is metered or cellular. */
  metered: boolean;
};

export type EligibilityBlock =
  | "no-webgpu"
  | "too-little-memory"
  | "too-little-storage"
  | "save-data"
  | "slow-connection"
  | "metered";

export type Eligibility =
  | { ok: true; model: LocalModel; note: string | null }
  | {
      ok: false;
      block: EligibilityBlock;
      /** A sentence saying what is wrong and what would change it. */
      reason: string;
      /** True when this could become true later without the person changing hardware. */
      transient: boolean;
    };

/** Headroom beyond the model itself, so the download does not fill the disk. */
const STORAGE_MARGIN_MB = 500;

const MB = 1_000_000;

/**
 * Can this machine run a local model, and which one.
 *
 * Ordered so the answer a person gets is the most fundamental thing wrong,
 * not the first thing checked. Telling someone their connection is slow when
 * their browser could never have run it regardless wastes their time.
 */
export function evaluateEligibility(device: DeviceProfile): Eligibility {
  if (!device.webgpu) {
    return {
      ok: false,
      block: "no-webgpu",
      reason:
        "This browser cannot reach the graphics card, so a local model would take minutes to answer. Chrome, Edge or a recent Safari on a desktop will.",
      transient: false,
    };
  }

  const memoryMb = device.memoryGb == null ? null : device.memoryGb * 1_000;
  const model = bestModelForMemory(memoryMb);
  if (!model) {
    return {
      ok: false,
      block: "too-little-memory",
      reason: `This machine reports ${device.memoryGb} GB of memory, which is not enough to hold even the smallest model alongside the browser.`,
      transient: false,
    };
  }

  if (device.storageFreeBytes != null) {
    const neededMb = model.downloadMb + STORAGE_MARGIN_MB;
    const freeMb = device.storageFreeBytes / MB;
    if (freeMb < neededMb) {
      return {
        ok: false,
        block: "too-little-storage",
        reason: `Needs about ${humanSize(neededMb)} free and this browser has ${humanSize(freeMb)}. Clearing space will let it through.`,
        transient: true,
      };
    }
  }

  // The remaining checks are about the download, not the machine. All three are
  // temporary states, and all three are ones where quietly pulling a gigabyte
  // would be a genuinely hostile thing to do.
  if (device.saveData) {
    return {
      ok: false,
      block: "save-data",
      reason:
        "Data saver is on, so nothing large is downloaded automatically. You can still start the download yourself.",
      transient: true,
    };
  }

  if (device.metered) {
    return {
      ok: false,
      block: "metered",
      reason:
        "This looks like a phone connection. The download waits for wifi, or you can start it now if the data is not a problem.",
      transient: true,
    };
  }

  if (device.connection === "slow-2g" || device.connection === "2g" || device.connection === "3g") {
    return {
      ok: false,
      block: "slow-connection",
      reason: `A ${humanSize(model.downloadMb)} download on this connection would take a long time. It waits for something faster.`,
      transient: true,
    };
  }

  return {
    ok: true,
    model,
    note:
      model.permissive
        ? null
        : `Falling back to ${model.label} because of the memory available here.`,
  };
}

export type DownloadDecision = {
  /** Start fetching without asking. */
  auto: boolean;
  /** Show the one-time ask. */
  prompt: boolean;
  /** Nothing to do, and why. */
  blocked: Eligibility & { ok: false } | null;
};

/**
 * What to actually do on this page load.
 *
 * The setting being on is permission for the feature, not for the transfer. A
 * download this size gets asked about once, and never again on that machine —
 * asking every time is its own kind of rude, and so is never asking at all.
 */
export function downloadDecision(input: {
  enabled: boolean;
  /** The person has already agreed to the download on this machine. */
  consented: boolean;
  /** The model is already on disk. */
  cached: boolean;
  device: DeviceProfile;
}): DownloadDecision {
  if (!input.enabled) return { auto: false, prompt: false, blocked: null };

  const eligibility = evaluateEligibility(input.device);
  if (!eligibility.ok) {
    // A cached model still runs on a metered connection: the objection was
    // always to the transfer, never to the model. Refusing to load one already
    // on disk would be applying the rule past the reason for it.
    if (input.cached && eligibility.transient) {
      return { auto: true, prompt: false, blocked: null };
    }
    return { auto: false, prompt: false, blocked: eligibility };
  }

  if (input.cached) return { auto: true, prompt: false, blocked: null };
  if (!input.consented) return { auto: false, prompt: true, blocked: null };
  return { auto: true, prompt: false, blocked: null };
}

/** The sentence on the one-time ask. States the cost before the benefit. */
export function consentCopy(model: LocalModel): string {
  return `Vantage can run a small model on this computer instead of sending your team's notes to a server. It is a ${humanSize(model.downloadMb)} download, once, and it stays on this machine. ${model.rationale}`;
}
