/**
 * How a form option reads on screen. The stored value stays as written ("west coast", "c++"),
 * since analysis keys on it; only the words a scout taps are cased: the pit form showed
 * "swerve", "java" and "labview" in lowercase, like developer values.
 */
const KNOWN: Record<string, string> = {
  "c++": "C++",
  "c#": "C#",
  labview: "LabVIEW",
  java: "Java",
  python: "Python",
  kotlin: "Kotlin",
  swerve: "Swerve",
  "west coast": "West coast",
  west_coast: "West coast",
  tank: "Tank",
  mecanum: "Mecanum",
  other: "Other",
  none: "None",
  partial: "Partial",
  full: "Full",
};

export function scoutOptionLabel(value: string): string {
  const raw = value.trim();
  const known = KNOWN[raw.toLowerCase()];
  if (known) return known;
  const spaced = raw.replaceAll("_", " ");
  // Only an all-lowercase value is cased: "SCC" or "Falcon 500" was written that way on purpose.
  return spaced === spaced.toLowerCase() ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced;
}
