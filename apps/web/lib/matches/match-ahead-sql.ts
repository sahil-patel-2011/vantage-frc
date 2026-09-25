/**
 * "This match is still to come", in SQL, the same everywhere a screen picks our next match.
 *
 * It used to be "its scheduled time is still in the future". When an event ran 30 minutes late,
 * Qual 31 (3:07 PM, not played) dropped off at 3:08 and Home, Event day, the briefing and the pit
 * TV all jumped to Qual 33 while the field was still on 31.
 *
 * A match is over once it has a result or a start time, once any later qualification match at the
 * event has one (the field has moved past it even if its own result never synced), or once its
 * scheduled time is more than three hours gone. Anything else is still ahead, late or not.
 *
 * `alias` is the matches_ref alias in the calling query ("m"); with none, the table name is used,
 * so the subquery below never confuses its own rows with the outer one's.
 */
export function matchStillAheadSql(alias?: string): string {
  const a = `${alias || "matches_ref"}.`;
  return `NOT (
    ${a}winning_alliance IS NOT NULL
    OR ${a}post_result_time IS NOT NULL
    OR ${a}actual_time IS NOT NULL
    OR COALESCE(${a}predicted_time, ${a}event_time) <= now() - interval '3 hours'
    OR (
      ${a}comp_level = 'qm'
      AND EXISTS (
        SELECT 1 FROM matches_ref later_m
         WHERE later_m.event_key = ${a}event_key
           AND later_m.comp_level = 'qm'
           AND later_m.match_number > ${a}match_number
           AND (later_m.winning_alliance IS NOT NULL OR later_m.post_result_time IS NOT NULL OR later_m.actual_time IS NOT NULL)
      )
    )
  )`;
}
