/**
 * Publishing a scouting form on venue Wi-Fi.
 *
 * Publish used the 8-second read timeout. A slow answer showed "Could not confirm publication",
 * the lead retried, and if the first request had landed after all the retry hit the "Refresh the
 * form editor" conflict. A write now waits 30 seconds, and when it still gets no answer the
 * editor reads the published forms back and says which happened: published (as version N), not
 * published, or someone else published in the meantime.
 *
 * Pure, so it is tested.
 */

import type { SchemaDefinition } from "@vantage/scouting";
import { stripScoutIdentityFields } from "@vantage/scouting/identity";

export const PUBLISH_TIMEOUT_MS = 30_000;
/** The read-back after a publish that got no answer. */
export const PUBLISH_CHECK_TIMEOUT_MS = 15_000;

/** JSON with object keys sorted, so a definition compares equal after a jsonb round trip. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type PublishCheck =
  | { kind: "published"; id: string; version: number; definition: SchemaDefinition }
  | { kind: "not-published" }
  | { kind: "someone-else"; version: number };

/** What the published form says about a publish whose answer never arrived. */
export function publishOutcomeAfterTimeout(input: {
  /** The version the editor was based on when Publish was pressed. */
  baseSchemaId: string | null;
  sent: SchemaDefinition;
  latest: { id: string; version: number; definition: SchemaDefinition } | null;
}): PublishCheck {
  const { latest } = input;
  if (!latest || latest.id === input.baseSchemaId) return { kind: "not-published" };
  const sent = canonicalJson(stripScoutIdentityFields(input.sent).definition);
  if (canonicalJson(latest.definition) === sent) {
    return { kind: "published", id: latest.id, version: latest.version, definition: latest.definition };
  }
  return { kind: "someone-else", version: latest.version };
}

export function publishCheckMessage(check: PublishCheck | null): string {
  if (!check) {
    return "No answer from your team’s server, and the published form could not be checked. Your draft is still here. When the connection is back, reload this page: it shows whether the form was published.";
  }
  if (check.kind === "published") return `Published as version ${check.version}. The answer was slow, but the form is live.`;
  if (check.kind === "not-published") return "Not published: the connection dropped before your team’s server got it. Your draft is still here, so publish again.";
  return `Another lead published version ${check.version} while yours was sending. Your draft is still here. Review the latest form before publishing.`;
}
