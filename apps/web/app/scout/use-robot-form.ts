"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScoutSchema } from "@vantage/scouting";
import { readScoutDraft } from "../../lib/scouting/draft-autosave";
import { chooseRobotForm, type EarlierReport, type RobotFormChoice } from "../../lib/scouting/robot-form";

const FORM_FETCH_TIMEOUT_MS = 15_000;

/**
 * The form (and starting answers) for the robot or pit on screen: the one a draft was started
 * on, or the one an earlier report was saved under, fetched when this phone does not have it.
 * See lib/scouting/robot-form.ts. Null until there is a robot and a live form.
 */
export function useRobotForm(input: {
  orgId: string;
  live: ScoutSchema | null;
  /** The draft's key on this phone (null when the scout or event is unknown). */
  draftKey: string | null;
  earlier: EarlierReport | null;
  /** Which robot or pit is open; a new one reads its draft again. */
  target: string | null;
}): RobotFormChoice | null {
  const { orgId, live, draftKey, earlier, target } = input;
  const [known, setKnown] = useState<ReadonlyMap<string, ScoutSchema>>(() => new Map());
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());

  const choice = useMemo(() => {
    if (!target || !live) return null;
    return chooseRobotForm({ live, draft: readScoutDraft(draftKey), earlier, known, unavailable });
  }, [target, live, draftKey, earlier, known, unavailable]);

  const fetchId = choice?.kind === "fetch" ? choice.schemaId : null;
  useEffect(() => {
    if (!fetchId) return;
    const giveUp = () => setUnavailable((current) => new Set(current).add(fetchId));
    if (navigator.onLine === false) {
      giveUp();
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/scouting/schemas?${new URLSearchParams({ orgId, schemaId: fetchId })}`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FORM_FETCH_TIMEOUT_MS)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { schemas?: ScoutSchema[] };
        const original = body.schemas?.find((schema) => schema.id === fetchId && schema.orgId === orgId);
        if (!original) throw new Error("missing");
        if (!controller.signal.aborted) setKnown((current) => new Map(current).set(fetchId, original));
      })
      .catch(() => {
        if (!controller.signal.aborted) giveUp();
      });
    return () => controller.abort();
  }, [fetchId, orgId]);

  return choice;
}
