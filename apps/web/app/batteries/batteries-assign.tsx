"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import type { Pack, RunFn } from "./batteries-model";

export function AssignRow({
  pack,
  orgId,
  busy,
  run,
}: {
  pack: Pack;
  orgId: string;
  busy: boolean;
  run: RunFn;
}) {
  const [value, setValue] = useState(pack.assignment);
  useEffect(() => {
    setValue(pack.assignment);
  }, [pack.assignment]);

  /*
    Save appears when there is something to save.

    Eighteen packs meant eighteen permanent Save buttons down the page, all of
    them doing nothing, all of them in the tab order and read out by a screen
    reader. A button that is disabled-in-spirit is worse than no button: it
    implies there is an action waiting.

    Enter in the field still submits, so the keyboard path does not depend on
    the button existing.
  */
  const dirty = value.trim() !== pack.assignment.trim();

  return (
    <form
      className="batt-assign"
      onSubmit={(event) => {
        event.preventDefault();
        void run({ action: "assign_pack", orgId, id: pack.id, assignment: value.trim() }, `assign:${pack.id}`);
      }}
    >
      <label>
        Assignment
        <input
          value={value}
          disabled={busy}
          placeholder="Robot · Charger A · Spare cart"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {dirty ? (
        <Button variant="secondary" type="submit" disabled={busy}>
          Save
        </Button>
      ) : null}
    </form>
  );
}
