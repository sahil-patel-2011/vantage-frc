/**
 * Project a stored SOP template onto the pit / match checklist item shape.
 *
 * Checklist library is the SOP. Timed pit execution lives on `match_checklist_runs`.
 * This helper never invents pit cues that are not in the SOP, and it never writes a
 * library run — match-checklist stays the system of record.
 */

import { hubHref } from "../nav/hubs";
import type {
  ChecklistLibraryItem,
  PitChecklistInstantiation,
  PitChecklistItem,
  PitChecklistItemKey,
  TemplatePitPreview,
} from "./types";
import { PIT_CHECKLIST_ITEM_KEYS } from "./types";

const PIT_KEY_SET = new Set<string>(PIT_CHECKLIST_ITEM_KEYS);

/** Exact token → pit key. Checked after an already-canonical key. */
const TOKEN_ALIASES: Record<string, PitChecklistItemKey> = {
  bumper: "bumper",
  bumpers: "bumper",
  hang_bumpers: "bumper",
  bumper_color: "bumper",
  battery: "battery",
  batteries: "battery",
  battery_strap: "battery",
  battery_seated: "battery",
  tether: "tether",
  estop: "tether",
  e_stop: "tether",
  tether_estop: "tether",
  code: "code",
  radio: "code",
  deployed: "code",
  code_deployed: "code",
  sb50: "sb50",
  sb_50: "sb50",
  ds_power: "ds_power",
  ds: "ds_power",
  driver_station: "ds_power",
  laptop: "ds_power",
  laptop_charging: "ds_power",
  never_sleep: "ds_power",
  ds_ethernet: "ds_ethernet",
  ethernet: "ds_ethernet",
  ds_eth: "ds_ethernet",
  ds_estop: "ds_estop",
  game_bar: "ds_estop",
  spacebar: "ds_estop",
  spacebar_estop: "ds_estop",
  ds_shelf: "ds_shelf",
  hook_and_loop: "ds_shelf",
  velcro: "ds_shelf",
  shelf: "ds_shelf",
  lenses: "lenses",
  lens: "lenses",
  vision: "lenses",
  camera: "lenses",
  wipe: "lenses",
  bolts: "bolts",
  bolt: "bolts",
  bolt_check: "bolts",
  swerve_bolts: "bolts",
  kraken_screws: "kraken_screws",
  kraken: "kraken_screws",
  kraken_power: "kraken_screws",
  anderson_lock: "anderson_lock",
  anderson: "anderson_lock",
  controller_lock: "controller_lock",
  tape: "controller_lock",
  controller: "controller_lock",
  controller_buttons: "controller_lock",
  ds_usb: "ds_usb",
  usb: "ds_usb",
  joystick: "ds_usb",
  joysticks: "ds_usb",
};

/**
 * Phrase fragments, longest / most specific first, so "kraken power screws"
 * does not collapse to the generic bolt check.
 */
const LABEL_PHRASES: Array<{ needle: string; key: PitChecklistItemKey }> = [
  { needle: "kraken", key: "kraken_screws" },
  { needle: "controller", key: "controller_lock" },
  { needle: "game bar", key: "ds_estop" },
  { needle: "spacebar", key: "ds_estop" },
  { needle: "hook-and-loop", key: "ds_shelf" },
  { needle: "hook and loop", key: "ds_shelf" },
  { needle: "anderson", key: "anderson_lock" },
  { needle: "ethernet", key: "ds_ethernet" },
  { needle: "joystick", key: "ds_usb" },
  { needle: "sb50", key: "sb50" },
  { needle: "sb 50", key: "sb50" },
  { needle: "driver station", key: "ds_power" },
  { needle: "never sleep", key: "ds_power" },
  { needle: "bumper", key: "bumper" },
  { needle: "battery", key: "battery" },
  { needle: "tether", key: "tether" },
  { needle: "e-stop", key: "tether" },
  { needle: "estop", key: "tether" },
  { needle: "radio", key: "code" },
  { needle: "code", key: "code" },
  { needle: "lens", key: "lenses" },
  { needle: "vision", key: "lenses" },
  { needle: "bolt", key: "bolts" },
  { needle: "tape", key: "controller_lock" },
  { needle: "usb", key: "ds_usb" },
  { needle: "shelf", key: "ds_shelf" },
  { needle: "laptop", key: "ds_power" },
];

export function isPitChecklistItemKey(value: string): value is PitChecklistItemKey {
  return PIT_KEY_SET.has(value);
}

export function normalizeSopToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mapSopItemToPitKey(item: ChecklistLibraryItem): PitChecklistItemKey | null {
  if (isPitChecklistItemKey(item.key)) return item.key;
  const keyToken = normalizeSopToken(item.key);
  if (isPitChecklistItemKey(keyToken)) return keyToken;
  if (TOKEN_ALIASES[keyToken]) return TOKEN_ALIASES[keyToken];

  const labelToken = normalizeSopToken(item.label);
  if (isPitChecklistItemKey(labelToken)) return labelToken;
  if (TOKEN_ALIASES[labelToken]) return TOKEN_ALIASES[labelToken];

  const label = item.label.toLowerCase();
  for (const { needle, key } of LABEL_PHRASES) {
    if (label.includes(needle)) return key;
  }
  return null;
}

/**
 * Map SOP items onto pit keys. First SOP line that claims a pit key wins;
 * later duplicates stay unmapped rather than inventing a second bumper row.
 * Unmapped lines are reported, never silently dropped.
 */
export function mapSopItemsToPitChecklist(items: ChecklistLibraryItem[]): {
  items: PitChecklistItem[];
  unmapped: ChecklistLibraryItem[];
} {
  const mapped: PitChecklistItem[] = [];
  const unmapped: ChecklistLibraryItem[] = [];
  const claimed = new Set<PitChecklistItemKey>();

  for (const item of items) {
    const key = mapSopItemToPitKey(item);
    if (!key || claimed.has(key)) {
      unmapped.push(item);
      continue;
    }
    claimed.add(key);
    mapped.push({
      key,
      label: item.label,
      done: false,
      checkedAt: null,
      sourceSopKey: item.key,
    });
  }

  return { items: mapped, unmapped };
}

export function previewPitChecklistInstantiation(items: ChecklistLibraryItem[]): TemplatePitPreview {
  const mapped = mapSopItemsToPitChecklist(items);
  return { mappedCount: mapped.items.length, unmapped: mapped.unmapped };
}

export function canInstantiatePitChecklist(items: ChecklistLibraryItem[]): boolean {
  return mapSopItemsToPitChecklist(items).items.length > 0;
}

export function instantiatePitChecklistFromSop(
  template: { id: string; name: string; items: ChecklistLibraryItem[] },
  input: { matchLabel: string },
): PitChecklistInstantiation {
  const matchLabel = input.matchLabel.trim();
  if (!matchLabel) {
    throw new Error("matchLabel is required to instantiate a pit checklist.");
  }
  const mapped = mapSopItemsToPitChecklist(template.items);
  if (mapped.items.length === 0) {
    throw new Error(
      "This SOP has no pit/match cues. Name items after pit checks (bumpers, SB50, battery) or start a library run instead.",
    );
  }
  return {
    source: "checklist-library",
    templateId: template.id,
    templateName: template.name,
    matchLabel,
    items: mapped.items,
    unmapped: mapped.unmapped,
  };
}

/** Event Day pit tab — the system of record this helper writes into. */
export function pitChecklistHref(orgId: string | null | undefined): string {
  return hubHref("/competition", "match-checklist", orgId);
}

/** Payload `match_checklist_runs.items` already stores. Extra SOP fields travel along. */
export function pitRunItemsJson(
  instantiation: PitChecklistInstantiation,
): Array<PitChecklistItem & { sourceTemplateId: string; sourceTemplateName: string }> {
  return instantiation.items.map((item) => ({
    ...item,
    sourceTemplateId: instantiation.templateId,
    sourceTemplateName: instantiation.templateName,
  }));
}
