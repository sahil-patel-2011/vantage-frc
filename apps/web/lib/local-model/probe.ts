/**
 * Reading the machine, and remembering what the person decided about it.
 *
 * Deliberately the only impure file in this folder. Everything that decides
 * anything lives in `eligibility.ts` and takes a plain object, so the rules are
 * testable without a browser and this file stays small enough to read in one
 * go.
 *
 * Every API touched here is optional, non-standard, or both. `deviceMemory` and
 * `connection` are Chromium-only, `storage.estimate` is rejected outright in
 * some privacy configurations, and `navigator.gpu` is absent on anything older
 * than a couple of years. None of that is an error: a browser that declines to
 * describe itself gets null, and the rules treat null as unknown rather than as
 * bad news.
 */

import type { DeviceProfile } from "./eligibility";

const PREF_KEY = "vantage.localModel.enabled";
const CONSENT_KEY = "vantage.localModel.consented";

/**
 * On by default.
 *
 * The download is still gated — see `downloadDecision` — so this being true
 * means "this team wants the feature", not "send a gigabyte now".
 */
export const LOCAL_MODEL_DEFAULT_ENABLED = true;

type NavigatorConnection = {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
};

function connectionOf(): NavigatorConnection | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: NavigatorConnection;
    mozConnection?: NavigatorConnection;
    webkitConnection?: NavigatorConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

/** What this machine looks like right now. Never throws. */
export async function probeDevice(): Promise<DeviceProfile> {
  const unknown: DeviceProfile = {
    webgpu: false,
    memoryGb: null,
    storageFreeBytes: null,
    saveData: false,
    connection: null,
    metered: false,
  };
  if (typeof navigator === "undefined") return unknown;

  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const connection = connectionOf();

  let storageFreeBytes: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate && typeof estimate.quota === "number") {
      storageFreeBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0));
    }
  } catch {
    // Some privacy configurations reject this outright. Unknown, not zero:
    // treating a refusal as "no space" would disable the feature for exactly
    // the people who configured their browser carefully.
    storageFreeBytes = null;
  }

  return {
    webgpu: typeof nav.gpu !== "undefined" && nav.gpu !== null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    storageFreeBytes,
    saveData: connection?.saveData === true,
    connection: connection?.effectiveType ?? null,
    // `type` is reported by very few browsers, so a phone on a slow connection
    // is usually caught by effectiveType instead. Both are checked.
    metered: connection?.type === "cellular",
  };
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "1";
  } catch {
    // Private windows and locked-down school browsers throw. The default is a
    // better answer than a crash.
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Nothing to do: the setting just will not survive this session.
  }
}

export function localModelEnabled(): boolean {
  return readFlag(PREF_KEY, LOCAL_MODEL_DEFAULT_ENABLED);
}

export function setLocalModelEnabled(value: boolean): void {
  writeFlag(PREF_KEY, value);
}

/**
 * Whether the person has agreed to the download on this machine.
 *
 * Per machine, not per account, and deliberately so: agreeing to a gigabyte on
 * your laptop is not agreeing to it on the shared pit computer.
 */
export function localModelConsented(): boolean {
  return readFlag(CONSENT_KEY, false);
}

export function setLocalModelConsented(value: boolean): void {
  writeFlag(CONSENT_KEY, value);
}
