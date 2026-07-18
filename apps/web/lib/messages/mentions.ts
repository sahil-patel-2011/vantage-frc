/** Pure helpers for Team Messages @mentions (no DB). */

export type MentionMember = { id: string; name: string; email?: string };

export type MentionRef = { userId: string; name: string };

export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export type BodySegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; userId: string; name: string };

const MENTION_TRIGGER = /(^|[\s([{])@([^\s@]*)$/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findActiveMention(text: string, cursor: number): MentionQuery | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const match = before.match(MENTION_TRIGGER);
  if (!match || match.index == null) return null;
  const atIndex = match.index + match[1]!.length;
  return {
    start: atIndex,
    end: safeCursor,
    query: match[2] ?? "",
  };
}

export function filterMembersForMention(
  members: MentionMember[],
  query: string,
  limit = 8,
): MentionMember[] {
  const needle = query.trim().toLowerCase();
  const ranked = members
    .filter((member) => member.id && member.name?.trim())
    .map((member) => {
      const name = member.name.trim().toLowerCase();
      const email = (member.email ?? "").toLowerCase();
      if (!needle) return { member, score: 1 };
      if (name.startsWith(needle)) return { member, score: 3 };
      if (name.includes(needle)) return { member, score: 2 };
      if (email.startsWith(needle) || email.includes(needle)) return { member, score: 1 };
      return null;
    })
    .filter((item): item is { member: MentionMember; score: number } => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.member.name.localeCompare(b.member.name);
    });
  return ranked.slice(0, limit).map((item) => item.member);
}

export function applyMention(
  text: string,
  cursor: number,
  member: MentionMember,
): { text: string; cursor: number } {
  const active = findActiveMention(text, cursor);
  const label = member.name.trim();
  const insertion = `@${label} `;
  if (!active) {
    const next = `${text.slice(0, cursor)}${insertion}${text.slice(cursor)}`;
    return { text: next, cursor: cursor + insertion.length };
  }
  const next = `${text.slice(0, active.start)}${insertion}${text.slice(active.end)}`;
  return { text: next, cursor: active.start + insertion.length };
}

/** Longest-name-first, non-overlapping `@Name` matches in a message body. */
export function findMentionedUserIds(body: string, members: MentionMember[]): string[] {
  if (!body || !members.length) return [];
  const sorted = [...members]
    .filter((member) => member.id && member.name.trim())
    .sort((a, b) => b.name.trim().length - a.name.trim().length);

  const claimedRanges: Array<{ start: number; end: number }> = [];
  const found: string[] = [];

  for (const member of sorted) {
    const label = member.name.trim();
    const pattern = new RegExp(`@${escapeRegExp(label)}(?=$|[\\s.,!?;:)'"\\]])`, "g");
    for (const match of body.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0]!.length;
      const overlaps = claimedRanges.some((range) => start < range.end && end > range.start);
      if (overlaps) continue;
      claimedRanges.push({ start, end });
      if (!found.includes(member.id)) found.push(member.id);
    }
  }
  return found;
}

/** Keep only mention ids whose `@Name` token still appears in the body. */
export function pruneMentionIds(
  body: string,
  mentions: MentionRef[],
  selectedIds: string[],
): string[] {
  const present = new Set(
    findMentionedUserIds(
      body,
      mentions.map((item) => ({ id: item.userId, name: item.name })),
    ),
  );
  return selectedIds.filter((id) => present.has(id));
}

export function bodyIncludesMention(body: string, name: string): boolean {
  return findMentionedUserIds(body, [{ id: "x", name }]).includes("x");
}

/**
 * Resolve which member ids should be notified for a message body.
 * Uses longest-name-first span claiming so "@Alex Rivera" is not "@Alex".
 */
export function resolveMentionedUserIds(
  body: string,
  members: MentionMember[],
  claimedIds: string[],
  authorUserId: string,
): string[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const fromBody = new Set(
    findMentionedUserIds(body, members).filter((id) => id !== authorUserId),
  );

  const resolved = new Set<string>();
  for (const id of claimedIds) {
    if (id === authorUserId) continue;
    if (!byId.has(id)) continue;
    if (fromBody.has(id)) resolved.add(id);
  }
  for (const id of fromBody) resolved.add(id);
  return [...resolved];
}

/** Split a message body into plain text and mention spans for rendering. */
export function segmentMessageBody(body: string, mentions: MentionRef[]): BodySegment[] {
  if (!body) return [];
  if (!mentions.length) return [{ kind: "text", value: body }];

  const unique = new Map<string, MentionRef>();
  for (const mention of mentions) {
    const name = mention.name.trim();
    if (!name || !mention.userId) continue;
    const key = name.toLowerCase();
    const existing = unique.get(key);
    if (!existing || existing.name.length < name.length) unique.set(key, { ...mention, name });
  }

  const labels = [...unique.values()].sort((a, b) => b.name.length - a.name.length);
  if (!labels.length) return [{ kind: "text", value: body }];

  const pattern = new RegExp(
    `@(${labels.map((item) => escapeRegExp(item.name)).join("|")})(?=$|[\\s.,!?;:)'"\\]])`,
    "g",
  );

  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", value: body.slice(lastIndex, index) });
    }
    const name = match[1]!;
    const ref =
      labels.find((item) => item.name === name) ??
      labels.find((item) => item.name.toLowerCase() === name.toLowerCase());
    segments.push({
      kind: "mention",
      value: match[0]!,
      userId: ref?.userId ?? "",
      name: ref?.name ?? name,
    });
    lastIndex = index + match[0]!.length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIndex) });
  }
  return segments.length ? segments : [{ kind: "text", value: body }];
}
