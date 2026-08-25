/**
 * Vantage -> The Purple Standard -> Vantage must be lossless for every field
 * both sides support.
 *
 * The export half is `packages/export-center`'s `scouting-purple-standard`
 * adapter, whose SQL writes the six TPS buckets as JSON text columns: `data`
 * holds the Vantage match payload verbatim, `metadata` holds event / match /
 * bot / scouter / timestamps, and abilities / counters / ratings / timers are
 * emitted as empty objects. This test reads the adapter's real column list out
 * of the registry so the two halves cannot drift apart silently, then rebuilds
 * an entry the way the export writes it and imports it back.
 */
import { describe, expect, it } from "vitest";
import { createExportRegistry } from "@vantage/export-center";
import {
  PURPLE_STANDARD_BUCKETS,
  purpleStandardEntriesToDrafts,
  purpleStandardHash,
} from "@vantage/import";

function purpleStandardAdapter() {
  return createExportRegistry().get("scouting-purple-standard");
}

/**
 * One exported row, in the exact column shape the adapter's SQL produces. The
 * payload is a Vantage match payload; nothing here is presented as real FRC
 * competition data.
 */
const EXPORTED_ROW = {
  abilities: "{}",
  counters: "{}",
  data: JSON.stringify({ autoCoral: 2, teleCoral: 5, climb: "deep", defensePlayed: false }),
  metadata: JSON.stringify({
    event: "2025mokc",
    match: { level: "qm", number: 12, set: 1 },
    bot: "9991",
    scouter: { team: "9991", app: "Vantage" },
    timestamp: 1740000000000,
    "modified-timestamp": 1740000000000,
  }),
  ratings: "{}",
  timers: "{}",
};

/** Reassemble the exported row into the TPS entry object a file would carry. */
function entryFromExportedRow(row: Record<string, string>) {
  const entry: Record<string, unknown> = {};
  for (const bucket of PURPLE_STANDARD_BUCKETS) {
    entry[bucket] = JSON.parse(row[bucket]!);
  }
  return entry;
}

describe("Purple Standard round trip", () => {
  it("keeps the export adapter's columns as the six TPS buckets", () => {
    const adapter = purpleStandardAdapter();
    expect(adapter, "the scouting-purple-standard export adapter must exist").toBeTruthy();
    expect(adapter!.columns).toEqual([...PURPLE_STANDARD_BUCKETS]);
  });

  it("re-imports an exported entry with its payload intact", () => {
    const entry = entryFromExportedRow(EXPORTED_ROW);
    const result = purpleStandardEntriesToDrafts({
      content: JSON.stringify([entry]),
      now: new Date("2025-03-01T00:00:00.000Z"),
    });

    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);

    const draft = result.drafts[0]!;
    expect(draft.eventKey).toBe("2025mokc");
    expect(draft.teamKey).toBe("frc9991");
    // The export writes qm12 as `<event>_qm12`; the importer must rebuild it.
    expect(draft.matchKey).toBe("2025mokc_qm12");

    // Lossless for the fields both sides support: every `data` key survives
    // with its value and its type.
    const exported = JSON.parse(EXPORTED_ROW.data) as Record<string, unknown>;
    for (const [key, value] of Object.entries(exported)) {
      expect(draft.payload[key]).toEqual(value);
    }
  });

  it("rebuilds sf and f match keys the same way the export writes them", () => {
    const build = (match: Record<string, unknown>) =>
      purpleStandardEntriesToDrafts({
        content: JSON.stringify([
          { data: { autoCoral: 1 }, metadata: { event: "2025mokc", bot: "9991", match } },
        ]),
      }).drafts[0]?.matchKey;

    expect(build({ level: "qm", number: 12, set: 1 })).toBe("2025mokc_qm12");
    expect(build({ level: "sf", number: 1, set: 3 })).toBe("2025mokc_sf3m1");
    expect(build({ level: "f", number: 2, set: 1 })).toBe("2025mokc_f1m2");
  });

  it("uses the TPS entry hash as the idempotency key, so a re-import is a no-op", () => {
    const entry = entryFromExportedRow(EXPORTED_ROW);
    const first = purpleStandardEntriesToDrafts({ content: JSON.stringify([entry]) });
    const second = purpleStandardEntriesToDrafts({
      // Same entry, keys written in a different order — the spec's hash sorts
      // keys alphabetically, so both must land on the same key.
      content: JSON.stringify([
        { timers: entry.timers, metadata: entry.metadata, data: entry.data, ratings: entry.ratings, counters: entry.counters, abilities: entry.abilities },
      ]),
    });
    expect(second.drafts[0]!.idempotencyKey).toBe(first.drafts[0]!.idempotencyKey);
    expect(first.drafts[0]!.idempotencyKey).toBe(`tps:${purpleStandardHash(entry)}`);
  });

  it("skips an entry that is missing the identity it needs, naming the field", () => {
    const result = purpleStandardEntriesToDrafts({
      content: JSON.stringify([
        { data: { autoCoral: 1 }, metadata: { bot: "9991", match: { level: "qm", number: 1 } } },
        { data: { autoCoral: 1 }, metadata: { event: "2025mokc", match: { level: "qm", number: 1 } } },
        { data: { autoCoral: 1 }, metadata: { event: "2025mokc", bot: "9991" } },
      ]),
    });
    expect(result.drafts).toHaveLength(0);
    expect(result.skipped.map((skip) => skip.reason)).toEqual([
      "metadata.event is missing",
      "metadata.bot must be an FRC team number",
      "metadata.match is missing",
    ]);
  });
});
