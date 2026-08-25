/**
 * The closed vocabulary of product events, and the validation that keeps it
 * closed.
 *
 * Everything here is pure so both the browser tracker and the API route run the
 * same rules: the client refuses to queue what the server would refuse to
 * store, and the server never trusts the client to have bothered.
 *
 * The privacy commitment is enforced by what this module *drops*, not by what
 * callers remember not to send:
 *   - `path` loses its query string and hash, and every id-shaped segment is
 *     collapsed to `:id`, so a record id or a typed search term cannot ride
 *     along inside a URL.
 *   - `meta` is flattened to a handful of short scalars. Objects, arrays, and
 *     long strings are dropped rather than truncated, because a truncated
 *     sentence is still a sentence someone typed.
 */

/** Keep in sync with the CHECK constraint in 0480_product_analytics.sql. */
export const PRODUCT_EVENT_NAMES = [
  /** A route was viewed. Fired by the tracker on navigation. */
  "page_view",
  /** A feature surface was opened (a panel, a tab, a drawer). */
  "feature_open",
  /** A deliberate action inside a feature (save, run, assign, ...). */
  "feature_action",
  /** A search was executed. The query itself is never sent. */
  "search_run",
  /** An export was started. */
  "export_run",
  /** An AI feature was invoked. Prompts are never sent here. */
  "ai_invoked",
  /** An onboarding step was completed. */
  "onboarding_step",
  /** A surface showed a setup-required state instead of working. */
  "setup_blocked",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const DEVICE_CLASSES = ["phone", "tablet", "desktop", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Matches the column widths and caps in 0480_product_analytics.sql. */
export const MAX_PATH_LENGTH = 200;
export const MAX_META_BYTES = 2048;
export const MAX_META_KEYS = 8;
export const MAX_META_KEY_LENGTH = 32;
export const MAX_META_STRING_LENGTH = 48;
/** One POST may carry at most this many events. */
export const MAX_BATCH_EVENTS = 40;

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

export function isDeviceClass(value: unknown): value is DeviceClass {
  return typeof value === "string" && (DEVICE_CLASSES as readonly string[]).includes(value);
}

/** Segments that look like an identifier rather than a route name. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Reduce a URL or pathname to a route shape.
 *
 * `/team/3d0f.../hours?member=amy#top` -> `/team/:id/hours`
 *
 * Anything that is not a plain path becomes `/`, so a malformed value can never
 * be stored verbatim.
 */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  let value = raw.trim();
  if (!value) return "/";

  // Accept an absolute URL by keeping only its pathname.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return "/";
    }
  }

  const cut = value.search(/[?#]/);
  if (cut >= 0) value = value.slice(0, cut);
  if (!value.startsWith("/")) value = `/${value}`;

  const segments = value
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // Leave the raw segment; it is still measured and masked below.
      }
      if (UUID_SEGMENT.test(decoded) || NUMERIC_SEGMENT.test(decoded) || OPAQUE_SEGMENT.test(decoded)) {
        return ":id";
      }
      // A segment that is not a plain slug is treated as data, not a route.
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(decoded)) return ":id";
      return decoded.toLowerCase();
    });

  const path = segments.length ? `/${segments.join("/")}` : "/";
  return path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
}

export type ProductEventMeta = Record<string, string | number | boolean>;

/**
 * Keep only short scalar values under short keys, capped in count and in total
 * bytes. Anything else is dropped silently — the event still records that the
 * thing happened, just without the detail we could not vouch for.
 */
export function sanitizeMeta(raw: unknown): ProductEventMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ProductEventMeta = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_META_KEYS) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key) || key.length > MAX_META_KEY_LENGTH) continue;
    if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = Math.round(value * 1000) / 1000;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      // Short, label-shaped strings only. Free text is not a label.
      if (!trimmed || trimmed.length > MAX_META_STRING_LENGTH) continue;
      if (!/^[A-Za-z0-9 ._:-]+$/.test(trimmed)) continue;
      out[key] = trimmed;
    } else {
      continue;
    }
    count += 1;
  }
  // Byte cap is the database's rule; drop trailing keys until it holds.
  const keys = Object.keys(out);
  while (keys.length && new TextEncoder().encode(JSON.stringify(out)).length > MAX_META_BYTES) {
    const last = keys.pop();
    if (last) delete out[last];
  }
  return out;
}

export type ProductEventInput = {
  event: ProductEventName;
  path: string;
  deviceClass: DeviceClass;
  meta: ProductEventMeta;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate one event from an untrusted payload. */
export function validateEvent(raw: unknown): ValidationResult<ProductEventInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Event must be an object" };
  }
  const record = raw as Record<string, unknown>;
  if (!isProductEventName(record.event)) {
    return { ok: false, error: `Unknown event name: ${String(record.event ?? "")}`.trim() };
  }
  const deviceClass = isDeviceClass(record.deviceClass) ? record.deviceClass : "unknown";
  return {
    ok: true,
    value: {
      event: record.event,
      path: normalizePath(record.path),
      deviceClass,
      meta: sanitizeMeta(record.meta),
    },
  };
}

/**
 * Validate a whole batch. One bad event does not discard the batch — it is
 * skipped and counted, so a single stale client cannot blind us to the rest.
 */
export function validateBatch(raw: unknown): ValidationResult<{ events: ProductEventInput[]; rejected: number }> {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
      ? ((raw as { events: unknown[] }).events)
      : null;
  if (!list) return { ok: false, error: "Expected an events array" };
  if (list.length === 0) return { ok: false, error: "Batch is empty" };
  if (list.length > MAX_BATCH_EVENTS) {
    return { ok: false, error: `Batch may contain at most ${MAX_BATCH_EVENTS} events` };
  }
  const events: ProductEventInput[] = [];
  let rejected = 0;
  for (const item of list) {
    const parsed = validateEvent(item);
    if (parsed.ok) events.push(parsed.value);
    else rejected += 1;
  }
  if (!events.length) return { ok: false, error: "No recognised events in batch" };
  return { ok: true, value: { events, rejected } };
}

/** Coarse device bucket from a viewport width. The whole device signal. */
export function deviceClassFromWidth(width: number | undefined): DeviceClass {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return "unknown";
  if (width < 768) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}
