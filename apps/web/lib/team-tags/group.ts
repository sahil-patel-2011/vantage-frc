export type TeamTagAssignment = {
  id: string;
  tagId: string;
  tagSlug: string;
  tagName: string;
  teamNumber: number;
  eventKey: string | null;
  matchKey: string | null;
  notes: string | null;
};

export type TagBoardColumn = {
  tagId: string;
  slug: string;
  name: string;
  teams: Array<{ teamNumber: number; assignmentId: string; notes: string | null; matchKey: string | null }>;
};

/** Group assignments into a drive-team board. Empty input stays empty. */
export function groupTeamTags(assignments: TeamTagAssignment[]): TagBoardColumn[] {
  const columns = new Map<string, TagBoardColumn>();
  for (const row of assignments) {
    const existing = columns.get(row.tagId);
    const entry = {
      teamNumber: row.teamNumber,
      assignmentId: row.id,
      notes: row.notes,
      matchKey: row.matchKey,
    };
    if (existing) {
      if (!existing.teams.some((team) => team.teamNumber === row.teamNumber && team.matchKey === row.matchKey)) {
        existing.teams.push(entry);
      }
    } else {
      columns.set(row.tagId, {
        tagId: row.tagId,
        slug: row.tagSlug,
        name: row.tagName,
        teams: [entry],
      });
    }
  }
  for (const column of columns.values()) {
    column.teams.sort((a, b) => a.teamNumber - b.teamNumber);
  }
  return [...columns.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function tagsForTeam(assignments: TeamTagAssignment[], teamNumber: number): string[] {
  return [
    ...new Set(
      assignments.filter((row) => row.teamNumber === teamNumber).map((row) => row.tagName),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** Tags that apply to robots at a named event. No event key → nothing to read. */
export function assignmentsForEvent(
  assignments: readonly TeamTagAssignment[],
  eventKey: string | null | undefined,
): TeamTagAssignment[] {
  if (!eventKey) return [];
  return assignments.filter((row) => row.eventKey === eventKey);
}

/** Board columns for the active event, or unscoped tags when no event is set. */
export function assignmentsForBoard(
  assignments: readonly TeamTagAssignment[],
  eventKey: string | null | undefined,
): TeamTagAssignment[] {
  if (eventKey) return assignmentsForEvent(assignments, eventKey);
  return assignments.filter((row) => row.eventKey == null);
}
