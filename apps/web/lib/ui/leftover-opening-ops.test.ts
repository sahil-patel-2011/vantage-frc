import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-scout. leftover-event-day-more Event day, leftover-hub-mismatch
 * Spares forecast / Spare kit / Alliance desk, leftover-strategy-titles
 * Justifier, leftover-scout-more Data impact / Coverage, leftover-media
 * Photos & video, leftover-hub Match video, leftover-opening-inbox Opening
 * Chat, leftover-copilot Inspection, leftover-pick-before Choose your team,
 * leftover-opening-scout Opening Scouting, leftover-fmea Failure log stay.
 * leftover-admin skip-list Global Team Manager stays. leftover-my-day
 * Loading My Day stays (hub My Day). leftover-join Loading… stays.
 * leftover-admin Loading team provisioning stays. Hub Schema A/B stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/logistics/logistics-related.ts",
  "lib/leadership/leadership-related.ts",
  "lib/inventory/inventory-related.ts",
  "lib/overnight-intel/overnight-intel-related.ts",
  "lib/spare-forecast/spare-forecast-related.ts",
  "lib/spare-robot-kit/spare-robot-kit-related.ts",
  "lib/picklist-justifier/picklist-justifier-related.ts",
  "lib/dossier/dossier-related.ts",
  "lib/scout-data-impact/scout-data-impact-related.ts",
  "lib/scouting/lineup-related.ts",
  "lib/scouting/form-builder.ts",
  "lib/media/media-related.ts",
  "lib/video-analysis/video-analysis-related.ts",
  "lib/video-rescout-related.ts",
  "lib/hours/hours-related.ts",
  "lib/parents/parents-related.ts",
  "lib/alumni/related.ts",
  "lib/account/connections-related.ts",
  "lib/ai-chat/ai-chat-related.ts",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/ai-memory/ai-memory-related.ts",
  "lib/writer/writer-related.ts",
] as const;

describe("leftover student opening-ops chrome", () => {
  it("does not print leftover related Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Event Day/);
    }
    const logistics = readFileSync(join(WEB, "lib/logistics/logistics-related.ts"), "utf8");
    expect(logistics).toMatch(/Opening Logistics/);
    expect(logistics).toMatch(/Choose your team/);
    const leadership = readFileSync(join(WEB, "lib/leadership/leadership-related.ts"), "utf8");
    expect(leadership).toMatch(/Opening Leadership/);
    expect(leadership).toMatch(/Choose your team/);
    const inventory = readFileSync(join(WEB, "lib/inventory/inventory-related.ts"), "utf8");
    expect(inventory).toMatch(/Opening Inventory/);
    expect(inventory).toMatch(/Choose your team/);
    expect(readFileSync(join(WEB, "lib/overnight-intel/overnight-intel-related.ts"), "utf8")).toMatch(
      /Opening Overnight brief/,
    );
    expect(readFileSync(join(WEB, "lib/spare-forecast/spare-forecast-related.ts"), "utf8")).toMatch(
      /Opening Spares forecast/,
    );
    expect(readFileSync(join(WEB, "lib/spare-robot-kit/spare-robot-kit-related.ts"), "utf8")).toMatch(
      /Opening Spare kit/,
    );
    expect(readFileSync(join(WEB, "lib/picklist-justifier/picklist-justifier-related.ts"), "utf8")).toMatch(
      /Opening Justifier/,
    );
    expect(readFileSync(join(WEB, "lib/dossier/dossier-related.ts"), "utf8")).toMatch(/Opening Team dossier/);
    expect(readFileSync(join(WEB, "lib/scout-data-impact/scout-data-impact-related.ts"), "utf8")).toMatch(
      /Opening Data impact/,
    );
    expect(readFileSync(join(WEB, "lib/scouting/lineup-related.ts"), "utf8")).toMatch(/Opening Coverage/);
    expect(readFileSync(join(WEB, "lib/scouting/form-builder.ts"), "utf8")).toMatch(/Opening Forms/);
    expect(readFileSync(join(WEB, "lib/media/media-related.ts"), "utf8")).toMatch(/Opening Media/);
    expect(readFileSync(join(WEB, "lib/media/media-related.ts"), "utf8")).toMatch(/Open Media kit/);
    expect(readFileSync(join(WEB, "lib/video-analysis/video-analysis-related.ts"), "utf8")).toMatch(
      /Opening Match video/,
    );
    expect(readFileSync(join(WEB, "lib/video-rescout-related.ts"), "utf8")).toMatch(/Opening Match video/);
    expect(readFileSync(join(WEB, "lib/hours/hours-related.ts"), "utf8")).toMatch(/Opening Hours/);
    expect(readFileSync(join(WEB, "lib/parents/parents-related.ts"), "utf8")).toMatch(/Opening Parent updates/);
    expect(readFileSync(join(WEB, "lib/alumni/related.ts"), "utf8")).toMatch(/Opening Alumni/);
    expect(readFileSync(join(WEB, "lib/account/connections-related.ts"), "utf8")).toMatch(/Opening connections/);
    expect(readFileSync(join(WEB, "lib/ai-chat/ai-chat-related.ts"), "utf8")).toMatch(/Opening Chat/);
    expect(readFileSync(join(WEB, "lib/inspection-copilot/inspection-copilot-related.ts"), "utf8")).toMatch(
      /Opening Inspection/,
    );
    expect(readFileSync(join(WEB, "lib/ai-memory/ai-memory-related.ts"), "utf8")).toMatch(/Opening Memory/);
    expect(readFileSync(join(WEB, "lib/writer/writer-related.ts"), "utf8")).toMatch(/Opening Writer/);
  });
});
