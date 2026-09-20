"use client";

/**
 * Things you have told the assistant to remember about you.
 *
 * All of this already existed and none of it could be reached. `user_memories`
 * has had a table, RLS, full CRUD on `AgentRepository`, a per-user on/off
 * switch, a token budget, and an API route at `/api/agent/memory` since the
 * early migrations — and `retrieveContext` has been injecting the rows into
 * every chat. Nothing in the app called any of it, so the only way a memory
 * could exist was for somebody to write one straight into Postgres.
 *
 * A feature with storage, a policy, an API and no door is worse than a missing
 * one: it looks finished from every direction except the one a person
 * approaches from.
 *
 * ## Private means private
 *
 * These rows belong to one person, not to the team. An owner cannot read them,
 * the nightly team-memory job does not touch them, and they are filtered out
 * of any prompt that leaves for a volunteer swarm — see the note at the top of
 * `ai-horde-pool.ts`. The copy says so plainly rather than in a policy
 * paragraph, because the difference between "the team can see this" and "only
 * you can" is the whole reason somebody would or would not write one down.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";

export type PersonalMemory = {
  id: string;
  kind: string;
  content: string;
  updatedAt: string;
};

/**
 * What a memory is about.
 *
 * A short list, and every one of them is something a student would actually
 * say about themselves. `kind` is stored free-form, so this constrains the UI
 * without constraining the data — a row written before this existed, with any
 * kind at all, still loads and still shows.
 */
export const MEMORY_KINDS = [
  { id: "role", label: "My role", hint: "Driver, programmer, safety captain — what you do on the team" },
  { id: "preference", label: "How I like answers", hint: "Short and direct, or worked through step by step" },
  { id: "context", label: "Something to keep in mind", hint: "Anything the assistant should not have to be told twice" },
] as const;

const MAX_LENGTH = 400;

function kindLabel(kind: string): string {
  return MEMORY_KINDS.find((row) => row.id === kind)?.label ?? kind;
}

export function PersonalMemories({ orgId }: { orgId: string }) {
  const [memories, setMemories] = useState<PersonalMemory[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<string>(MEMORY_KINDS[0].id);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/agent?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Could not load what the assistant remembers about you.");
        return;
      }
      const data = (await response.json()) as {
        memories?: PersonalMemory[];
        memorySettings?: { private?: { enabled?: boolean } };
      };
      setMemories(data.memories ?? []);
      setEnabled(data.memorySettings?.private?.enabled ?? true);
    } catch {
      setError("Could not load what the assistant remembers about you.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        // Forgetting is a DELETE with the id in the query string; everything
        // else is a POST action. That is the route's existing shape, not a
        // choice made here.
        const forgetting = typeof body.forget === "string";
        const response = await fetch(
          forgetting
            ? `/api/agent/memory?id=${encodeURIComponent(body.forget as string)}`
            : "/api/agent/memory",
          forgetting
            ? { method: "DELETE" }
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orgId, ...body }),
              },
        );
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "That did not save.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("That did not save.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orgId, load],
  );

  const trimmed = draft.trim();

  return (
    <section className="app-card soft-panel ai-memory-personal" aria-label="What the assistant remembers about you">
      <span className="eyebrow">ONLY YOU</span>
      <h2>What the assistant remembers about you</h2>
      <p className="app-muted">
        Tell it once and it knows next time. Nobody else on the team can see these — not an
        owner, not an admin — and they are never sent to the free volunteer swarm.
      </p>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="ai-memory-personal-add"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!trimmed) return;
          if (await act({ action: "save", kind, content: trimmed })) setDraft("");
        }}
      >
        <label>
          <span>About</span>
          <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)}>
            {MEMORY_KINDS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Remember that…</span>
          <input
            value={draft}
            disabled={busy}
            maxLength={MAX_LENGTH}
            placeholder={MEMORY_KINDS.find((row) => row.id === kind)?.hint ?? ""}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {/* Appears when there is something to save, like the rest of the app. */}
        {trimmed ? (
          <Button variant="primary" type="submit" disabled={busy}>
            Remember this
          </Button>
        ) : null}
      </form>

      {memories === null ? (
        <p className="app-muted">Loading…</p>
      ) : memories.length === 0 ? (
        <EmptyState
          soft
          title="Nothing yet"
          description="Anything you add here goes into every chat you start, so you do not have to explain yourself twice."
        />
      ) : (
        <ul className="ai-memory-personal-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <div>
                <span className="eyebrow">{kindLabel(memory.kind)}</span>
                <p>{memory.content}</p>
              </div>
              <button
                type="button"
                className="ai-memory-forget"
                // Named, because a list of identical "Forget" buttons is a list
                // of buttons nobody can tell apart.
                aria-label={`Forget: ${memory.content.slice(0, 60)}`}
                disabled={busy}
                onClick={() => void act({ forget: memory.id })}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        The switch stops them being used without deleting them, which is the
        thing somebody actually wants when an answer goes sideways and they are
        not sure which memory caused it.
      */}
      <label className="ai-memory-personal-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => {
            // Moves now, not when the round trip lands. A switch that stays
            // where it was for half a second reads as broken, and the reload
            // that follows is what makes it true — or puts it back.
            const next = event.target.checked;
            setEnabled(next);
            void act({ action: "toggle-private", enabled: next });
          }}
        />{" "}
        <span>
          <strong>Use these in my chats</strong>
          <small className="app-muted">
            Off keeps them here and leaves them out of every prompt. Nothing is deleted.
          </small>
        </span>
      </label>
    </section>
  );
}
