/**
 * match-names — a deliberately conservative free-text -> member matcher.
 *
 * attendance_entries.person_name has been free text since migration 0047, so a
 * team can have four seasons of "Sam R.", "sam rodriguez" and "Rodriguez, Sam"
 * that no longer join to anything. Migration 0478 adds an optional user_id; this
 * module proposes the link and a human confirms it.
 *
 * The rule that matters: WE NEVER SILENTLY MERGE TWO PEOPLE.
 *   - Auto-assignment requires an EXACT normalized full-name match to exactly one
 *     roster member. Nothing else is ever applied without confirmation.
 *   - Two members who normalize to the same string (twins, a junior and a senior
 *     with the same name) make the answer `ambiguous` with zero auto id. That is
 *     a question for a mentor, not a coin flip.
 *   - Nickname / initial / partial matches are `strong` or `weak` candidates and
 *     always route to `confirm`, never `auto`.
 *
 * Pure and dependency-free.
 */

export type NameMatchConfidence = "exact" | "strong" | "weak";

export type NameMatchCandidate = {
  userId: string;
  name: string;
  confidence: NameMatchConfidence;
  /** Human sentence explaining WHY this person is proposed. */
  reason: string;
};

export type NameMatchResolution = "auto" | "confirm" | "ambiguous" | "none";

export type NameMatchResult = {
  personName: string;
  normalized: string;
  candidates: NameMatchCandidate[];
  resolution: NameMatchResolution;
  /** Non-null ONLY for a single exact match. Every other case needs a human. */
  autoUserId: string | null;
  message: string;
};

export type RosterMember = { userId: string; name: string | null };

/** lower-case, de-accented, punctuation-stripped, whitespace-collapsed. */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Rodriguez, Sam" and "Sam Rodriguez" normalize to the same token order. */
function tokens(normalized: string): string[] {
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function sortedKey(normalized: string): string {
  return tokens(normalized).slice().sort().join(" ");
}

type Prepared = { member: RosterMember; normalized: string; parts: string[]; sorted: string };

function prepare(roster: RosterMember[]): Prepared[] {
  return roster
    .filter((member) => member.userId && (member.name ?? "").trim().length > 0)
    .map((member) => {
      const normalized = normalizeName(member.name ?? "");
      return { member, normalized, parts: tokens(normalized), sorted: sortedKey(normalized) };
    })
    .filter((entry) => entry.normalized.length > 0);
}

function candidate(
  entry: Prepared,
  confidence: NameMatchConfidence,
  reason: string,
): NameMatchCandidate {
  return { userId: entry.member.userId, name: entry.member.name ?? "", confidence, reason };
}

/**
 * Propose roster matches for one free-text attendance name.
 * `roster` should already be scoped to the org by the caller.
 */
export function matchPersonName(personName: string, roster: RosterMember[]): NameMatchResult {
  const normalized = normalizeName(personName);
  const prepared = prepare(roster);

  if (!normalized) {
    return {
      personName,
      normalized,
      candidates: [],
      resolution: "none",
      autoUserId: null,
      message: "This entry has no usable name to match.",
    };
  }

  const parts = tokens(normalized);
  const sorted = sortedKey(normalized);

  // 1. Exact — same tokens, any order ("Rodriguez, Sam" == "Sam Rodriguez").
  const exact = prepared.filter((entry) => entry.sorted === sorted);
  const onlyExact = exact.length === 1 ? exact[0] : undefined;
  if (onlyExact) {
    return {
      personName,
      normalized,
      candidates: [candidate(onlyExact, "exact", "Name matches this member exactly.")],
      resolution: "auto",
      autoUserId: onlyExact.member.userId,
      message: `Exact match: ${onlyExact.member.name}.`,
    };
  }
  if (exact.length > 1) {
    return {
      personName,
      normalized,
      candidates: exact.map((entry) =>
        candidate(entry, "exact", "More than one member has this exact name."),
      ),
      resolution: "ambiguous",
      autoUserId: null,
      message: `${exact.length} members share the name "${personName}". Pick the right person — this cannot be decided automatically.`,
    };
  }

  const seen = new Set<string>();
  const candidates: NameMatchCandidate[] = [];
  const push = (entry: Prepared, confidence: NameMatchConfidence, reason: string) => {
    if (seen.has(entry.member.userId)) return;
    seen.add(entry.member.userId);
    candidates.push(candidate(entry, confidence, reason));
  };

  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";

  // 2. Strong — first name plus a last-name initial, in either direction.
  //    Covers "Sam R" and "S Rodriguez" against "Sam Rodriguez".
  if (parts.length >= 2) {
    for (const entry of prepared) {
      if (entry.parts.length < 2) continue;
      const memberFirst = entry.parts[0] ?? "";
      const memberLast = entry.parts[entry.parts.length - 1] ?? "";
      const firstFull = memberFirst === first && memberLast.startsWith(last) && last.length >= 1;
      const lastFull =
        memberLast === last && memberFirst.startsWith(first) && first.length >= 1 && last.length > 1;
      if (firstFull || lastFull) {
        push(entry, "strong", `First name and ${firstFull ? "last" : "first"} initial line up.`);
      }
    }
  }

  // 3. Weak — a single token that matches a member's first or last name.
  if (parts.length === 1) {
    for (const entry of prepared) {
      if (entry.parts.includes(first)) {
        push(entry, "weak", `Only "${first}" was recorded — this member shares that name.`);
      }
    }
  } else {
    // Shared surname, different given name ("Alex Rodriguez" vs "Sam Rodriguez").
    for (const entry of prepared) {
      if (last && entry.parts.length > 1 && entry.parts[entry.parts.length - 1] === last) {
        push(entry, "weak", `Shares the surname "${last}" but the given name differs.`);
      }
    }
  }

  if (candidates.length === 0) {
    return {
      personName,
      normalized,
      candidates: [],
      resolution: "none",
      autoUserId: null,
      message: `No roster member resembles "${personName}". They may be a guest, a parent volunteer, or an alum — leaving this unlinked is a valid answer.`,
    };
  }

  const rank: Record<NameMatchConfidence, number> = { exact: 0, strong: 1, weak: 2 };
  candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name));

  const strongCount = candidates.filter((entry) => entry.confidence === "strong").length;
  if (strongCount > 1) {
    return {
      personName,
      normalized,
      candidates,
      resolution: "ambiguous",
      autoUserId: null,
      message: `"${personName}" could be ${strongCount} different members. Pick one — Vantage will not guess between people.`,
    };
  }

  const best = candidates[0];
  return {
    personName,
    normalized,
    candidates,
    resolution: "confirm",
    autoUserId: null,
    message: `"${personName}" looks like ${best ? best.name : "a roster member"}. Confirm before linking — nothing is applied automatically below an exact match.`,
  };
}

/** Batch the unmatched free-text backlog into a review queue. */
export function matchNameBacklog(
  names: { personName: string; entryCount: number }[],
  roster: RosterMember[],
): (NameMatchResult & { entryCount: number })[] {
  const results = names.map((row) => ({
    ...matchPersonName(row.personName, roster),
    entryCount: row.entryCount,
  }));
  // Easiest wins first: a one-click exact match, then things needing a decision.
  const order: Record<NameMatchResolution, number> = { auto: 0, confirm: 1, ambiguous: 2, none: 3 };
  return results.sort(
    (a, b) => order[a.resolution] - order[b.resolution] || b.entryCount - a.entryCount,
  );
}
