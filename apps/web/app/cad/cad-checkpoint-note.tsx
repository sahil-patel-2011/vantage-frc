export type CadCheckpointNoteProps = {
  /** Real Vantage checkpoint id after a native execute. Demo/mock/empty values are omitted. */
  checkpointId?: string | null;
};

/**
 * Accepts only a real stored checkpoint id. DEMO/mock/fake/placeholder values
 * are dropped so this note never invents or displays a fake id.
 */
export function honestCheckpointId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/demo|mock|fake|placeholder/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Honest CAD checkpoint copy: Vantage stores topology after each native
 * execute. Rollback is not a native Onshape action and there is no
 * FeatureScript fallback. Checkpoint ids appear only when a real one exists.
 */
export function CadCheckpointNote({ checkpointId }: CadCheckpointNoteProps) {
  const id = honestCheckpointId(checkpointId);

  return (
    <p className="app-muted" role="note">
      Vantage stores a topology checkpoint after each native execute. Rollback is not available as a native Onshape action (no FeatureScript fallback).{" "}
      {id ? (
        <>Last stored checkpoint: {id}.</>
      ) : (
        <>An id appears here once you store a checkpoint.</>
      )}
    </p>
  );
}
