import type { FieldDefinition } from "@vantage/scouting";
export type ScoutFormStage = "all" | "pre" | "auto" | "teleop" | "endgame" | "review";
export const SCOUT_STAGE_LABELS: Record<ScoutFormStage, string> = { all: "All answers", pre: "Before the match", auto: "Auto", teleop: "Teleop", endgame: "Endgame", review: "Review and save" };
const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
function namedStage(field: FieldDefinition): Exclude<ScoutFormStage, "all"> | null {
  const explicit = field.config?.scoutPhase;
  if (typeof explicit === "string" && ["pre", "auto", "teleop", "endgame", "review"].includes(explicit)) return explicit as Exclude<ScoutFormStage, "all">;
  const text = words(`${field.key} ${field.label}`);
  if (/start(ing)? (position|location)|pre match/.test(text)) return "pre";
  if (/\bauto(nomous)?\b/.test(text) || field.type === "auto_path") return "auto";
  if (/end ?game|climb|park|hang|dock/.test(text)) return "endgame";
  if (/teleop|tele op|driver control/.test(text)) return "teleop";
  if (/notes?|comments?|broke|breakdown|disabled|rating|accuracy|post match|total points|robot.?s points/.test(text)) return "review";
  return null;
}
/** Section headings carry phase context. Unrecognized fields stay accessible in every phase. */
export function matchFieldStages(fields: readonly FieldDefinition[]): Map<string, Exclude<ScoutFormStage, "all"> | null> {
  let section: Exclude<ScoutFormStage, "all"> | null = null;
  const result = new Map<string, Exclude<ScoutFormStage, "all"> | null>();
  for (const field of fields) {
    const named = namedStage(field);
    if (field.type === "section_header" || field.widget === "section") section = named;
    result.set(field.key, named ?? section);
  }
  return result;
}
export function fieldsForMatchStage(fields: readonly FieldDefinition[], stage: ScoutFormStage): FieldDefinition[] {
  if (stage === "all" || stage === "review") return [...fields];
  const stages = matchFieldStages(fields);
  return fields.filter(field => stages.get(field.key) === stage || stages.get(field.key) == null);
}
