import { describe, expect, it } from "vitest";
import {
  applyVoiceTranscriptToForm,
  BrowserVoiceDraftAdapter,
  coerceVoiceFieldValue,
  type SchemaDefinition,
} from "../src";

const schema: SchemaDefinition = {
  title: "Custom match",
  fields: [
    { key: "auto_score", label: "Auto score", type: "number" },
    { key: "endgame", label: "Endgame", type: "select", options: ["none", "partial", "full"] },
    { key: "disabled", label: "Disabled", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

describe("voice STT → custom form coercion", () => {
  it("coerces number, boolean, and select fragments", () => {
    expect(coerceVoiceFieldValue(schema.fields[0]!, "about 12 pieces")).toBe(12);
    expect(coerceVoiceFieldValue(schema.fields[2]!, "yes")).toBe(true);
    expect(coerceVoiceFieldValue(schema.fields[2]!, "nope")).toBeUndefined();
    expect(coerceVoiceFieldValue(schema.fields[1]!, "partial climb")).toBe("partial");
  });

  it("fills a targeted field from the whole transcript", () => {
    const result = applyVoiceTranscriptToForm(schema, {}, "clean defense on blue", {
      fieldKey: "notes",
    });
    expect(result.payload.notes).toBe("clean defense on blue");
    expect(result.appliedFieldKeys).toEqual(["notes"]);
    expect(result.unmatched).toBe("");
  });

  it("parses labeled segments across a custom schema", () => {
    const result = applyVoiceTranscriptToForm(
      schema,
      {},
      "Auto score 8, endgame full, disabled no, notes tipped near barge",
    );
    expect(result.payload).toEqual({
      auto_score: 8,
      endgame: "full",
      disabled: false,
      notes: "tipped near barge",
    });
    expect(result.appliedFieldKeys).toEqual(
      expect.arrayContaining(["auto_score", "endgame", "disabled", "notes"]),
    );
    expect(result.unmatched).toBe("");
  });

  it("parses custom form-builder field kinds", () => {
    const builderSchema: SchemaDefinition = {
      title: "Pit builder",
      fields: [
        {
          key: "drivetrain_type",
          label: "Drivetrain",
          type: "drivetrain_type",
          options: ["swerve", "tank", "mecanum", "other"],
        },
        { key: "notes", label: "Notes", type: "long_text" },
        { key: "photos", label: "Photos", type: "robot_image" },
      ],
    };
    const result = applyVoiceTranscriptToForm(
      builderSchema,
      {},
      "Drivetrain swerve, notes clean wiring",
    );
    expect(result.payload).toEqual({
      drivetrain_type: "swerve",
      notes: "clean wiring",
    });
    expect(result.appliedFieldKeys).not.toContain("photos");
  });
});

describe("BrowserVoiceDraftAdapter", () => {
  it("remembers browser STT text for an audio blob", async () => {
    const adapter = new BrowserVoiceDraftAdapter();
    const blob = new Blob(["audio"], { type: "audio/webm" });
    adapter.remember(blob, "  auto score 3  ");
    await expect(adapter.transcript(blob)).resolves.toBe("auto score 3");
  });

  it("errors when no browser transcript was paired", async () => {
    const adapter = new BrowserVoiceDraftAdapter();
    await expect(adapter.transcript(new Blob(["x"]))).rejects.toThrow(/speech recognition/i);
  });
});
