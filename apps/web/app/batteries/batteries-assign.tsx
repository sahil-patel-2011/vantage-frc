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
      <Button variant="secondary" type="submit" disabled={busy}>
        Save
      </Button>
    </form>
  );
}
