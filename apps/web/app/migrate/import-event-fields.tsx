"use client";

import { Button, FormGrid, FormRow } from "../../components/ui";
import type { ImportEventMode } from "../../lib/migrate/import-event";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";

/** Which event an import lands on: the active event, or a typed event key. */
export function ImportEventFields({
  required,
  activeKey,
  activeName,
  mode,
  typedKey,
  onMode,
  onTypedKey,
}: {
  required: boolean;
  activeKey: string | null;
  activeName: string | null;
  mode: ImportEventMode;
  typedKey: string;
  onMode: (mode: ImportEventMode) => void;
  onTypedKey: (value: string) => void;
}) {
  const label = activeKey ? scoutEventLabel({ eventName: activeName, eventKey: activeKey }) : null;
  const shown: ImportEventMode = label ? mode : "other";
  switch (shown) {
    case "all":
      return (
        <>
          <p className="app-muted">
            Your event is {label}. This import keeps every event in the file unless you narrow it.
          </p>
          <div className="migrate-actions">
            <Button variant="secondary" type="button" onClick={() => onMode("active")}>
              Only {label}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                onTypedKey("");
                onMode("other");
              }}
            >
              Enter an event key by hand…
            </Button>
          </div>
        </>
      );
    case "active":
      return (
        <>
          <FormGrid>
            <FormRow
              label="Event"
              hint={required ? "Scans are stored on this event." : "Only rows from this event are imported."}
            >
              <input readOnly aria-label="Event" value={label ?? ""} />
            </FormRow>
          </FormGrid>
          <div className="migrate-actions">
            {required ? null : (
              <Button variant="secondary" type="button" onClick={() => onMode("all")}>
                Every event in the file
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                onTypedKey("");
                onMode("other");
              }}
            >
              Enter an event key by hand…
            </Button>
          </div>
        </>
      );
    case "other":
      return (
        <>
          <FormGrid>
            <FormRow label={required ? "Event key" : "Event key (optional filter)"}>
              <input
                aria-label={required ? "Event key" : "Event key (optional filter)"}
                value={typedKey}
                onChange={(event) => onTypedKey(event.target.value)}
                placeholder="2025mokc"
              />
            </FormRow>
          </FormGrid>
          {label ? (
            <div className="migrate-actions">
              {required ? null : (
                <Button variant="secondary" type="button" onClick={() => onMode("all")}>
                  Every event in the file
                </Button>
              )}
              <Button variant="secondary" type="button" onClick={() => onMode("active")}>
                {label}
              </Button>
            </div>
          ) : null}
        </>
      );
    default: {
      const _never: never = shown;
      return _never;
    }
  }
}

