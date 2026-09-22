"use client";

import { useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import {
  CAPABILITY_LABEL,
  NEXT_SEASON_DISCLAIMER,
  NEXT_SEASON_EMPTY,
  SIGNAL_KIND_LABEL,
  capabilityReads,
  type Capability,
  type NextSeasonSignal,
  type SignalKind,
} from "../../lib/kickoff/next-season";
import type { RunFn } from "./kickoff-model";

const KINDS: SignalKind[] = ["announcement", "ftc-game", "teaser", "rumour"];
const CAPABILITIES = Object.keys(CAPABILITY_LABEL) as Capability[];

const CONFIDENCE_LABEL = {
  "well-supported": "Well supported",
  "worth-planning-for": "Worth planning for",
  thin: "Thin",
} as const;

/**
 * What the team has noticed about next year's game.
 *
 * This is a ledger, not a forecast. It groups notes people actually wrote down
 * and says how thin the evidence under each grouping is; it never states what
 * the game will be, because Vantage has no honest basis for that and a guess
 * filed next to real observations becomes indistinguishable from one within a
 * month.
 */
export function NextSeasonSection({
  signals,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  signals: NextSeasonSignal[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<SignalKind>("teaser");
  const [observedOn, setObservedOn] = useState("");
  const [pointsAt, setPointsAt] = useState<Capability[]>([]);
  const busy = busyKey != null;

  const reads = capabilityReads(signals);
  const ready = note.trim().length > 0 && observedOn.length > 0;

  function toggle(capability: Capability) {
    setPointsAt((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  }

  async function add() {
    await run(
      {
        action: "add_next_season_signal",
        orgId,
        seasonYear,
        kind,
        observedOn,
        source: source.trim(),
        note: note.trim(),
        pointsAt,
      },
      "add-next-season-signal",
    );
    setNote("");
    setSource("");
    setPointsAt([]);
  }

  return (
    <section className="app-card soft-panel kick-section">
      <h2>What next year might ask for</h2>
      <p className="app-muted">{NEXT_SEASON_DISCLAIMER}</p>

      {reads.length ? (
        <ul className="ns-reads">
          {reads.map((read) => (
            <li key={read.capability} data-confidence={read.confidence}>
              <div>
                <strong>{read.label}</strong>
                <em>{CONFIDENCE_LABEL[read.confidence]}</em>
              </div>
              <small>
                {read.signals} note{read.signals === 1 ? "" : "s"}
                {read.independentSources > 0
                  ? ` from ${read.independentSources} source${read.independentSources === 1 ? "" : "s"}`
                  : ""}
                . {read.because}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState soft title="Nothing spotted yet" description={NEXT_SEASON_EMPTY} />
      )}

      <form
        className="ns-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void add();
        }}
      >
        <label>
          What did you see?
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Teaser showed a robot reaching over a barrier"
            required
          />
        </label>
        <div className="ns-form-row">
          <label>
            Where
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Link, video, or who said it"
            />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as SignalKind)}>
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {SIGNAL_KIND_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seen on
            <input
              type="date"
              value={observedOn}
              onChange={(event) => setObservedOn(event.target.value)}
              required
            />
          </label>
        </div>
        <fieldset className="ns-capabilities">
          <legend>What does it point at?</legend>
          {CAPABILITIES.map((capability) => (
            <label key={capability}>
              <input
                type="checkbox"
                checked={pointsAt.includes(capability)}
                onChange={() => toggle(capability)}
              />
              {CAPABILITY_LABEL[capability]}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy || !ready}>
          {busyKey === "add-next-season-signal" ? "Saving…" : "Record it"}
        </Button>
      </form>

      {signals.length ? (
        <ol className="ns-log">
          {signals.map((signal) => (
            <li key={signal.id}>
              <div>
                <strong>{signal.note}</strong>
                <small>
                  {SIGNAL_KIND_LABEL[signal.kind]} · seen {signal.observedOn}
                  {signal.source ? ` · ${signal.source}` : ""}
                </small>
              </div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    { action: "delete_next_season_signal", orgId, id: signal.id },
                    `delete-signal-${signal.id}`,
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
