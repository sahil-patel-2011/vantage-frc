import { VIEW_ONLY_MESSAGE } from "../lib/nav/view-only";
import "./view-only.css";

/**
 * Shown where a page would otherwise offer an obvious write (Add task, Visit a
 * pit, Add event) to someone who is View only. One calm sentence, the same one
 * the API answers with, so the button never refuses after the fact.
 */
export function ViewOnlyNote({ className }: { className?: string }) {
  return (
    <p className={["view-only-note", className].filter(Boolean).join(" ")} role="note">
      {VIEW_ONLY_MESSAGE}
    </p>
  );
}
