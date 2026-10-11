import { describe, expect, it } from "vitest";
import type { SchemaDefinition } from "@vantage/scouting";
import { canonicalJson, PUBLISH_TIMEOUT_MS, publishCheckMessage, publishOutcomeAfterTimeout } from "./publish-confirm";
import { FEATURE_API_TIMEOUT_MS } from "../nav/me-request";

const sent: SchemaDefinition = {
  title: "Match",
  fields: [
    { key: "auto_points", label: "Auto points", type: "counter" },
    { key: "fouls", label: "Fouls called", type: "counter" },
  ],
};
// Postgres jsonb hands keys back in its own order.
const stored = JSON.parse('{"fields":[{"type":"counter","label":"Auto points","key":"auto_points"},{"label":"Fouls called","key":"fouls","type":"counter"}],"title":"Match"}') as SchemaDefinition;

describe("publishing a form on a slow network", () => {
  it("gives a write longer than a read", () => {
    expect(PUBLISH_TIMEOUT_MS).toBeGreaterThan(FEATURE_API_TIMEOUT_MS);
  });

  it("compares definitions regardless of key order", () => {
    expect(canonicalJson(sent)).toBe(canonicalJson(stored));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("says Published when the slow request landed", () => {
    const check = publishOutcomeAfterTimeout({ baseSchemaId: "v3", sent, latest: { id: "v4", version: 4, definition: stored } });
    expect(check).toMatchObject({ kind: "published", id: "v4", version: 4 });
    expect(publishCheckMessage(check)).toBe("Published as version 4. The answer was slow, but the form is live.");
  });

  it("says Not published when the form is still the one the editor started from", () => {
    const check = publishOutcomeAfterTimeout({ baseSchemaId: "v3", sent, latest: { id: "v3", version: 3, definition: stored } });
    expect(check).toEqual({ kind: "not-published" });
    expect(publishCheckMessage(check)).toMatch(/^Not published/);
    expect(publishOutcomeAfterTimeout({ baseSchemaId: null, sent, latest: null })).toEqual({ kind: "not-published" });
  });

  it("names a different lead's publish instead of claiming ours", () => {
    const other = { ...stored, title: "Match v2" };
    const check = publishOutcomeAfterTimeout({ baseSchemaId: "v3", sent, latest: { id: "v4", version: 4, definition: other } });
    expect(check).toEqual({ kind: "someone-else", version: 4 });
    expect(publishCheckMessage(null)).toMatch(/could not be checked/);
  });
});
