"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AllianceBoardState, AllianceSlot } from "../../../lib/strategy/pick-desk";

type DraftPayload = {
  orgId: string;
  eventKey: string;
  eventName: string | null;
  canEdit: boolean;
  board: {
    id: string;
    name: string;
    pickListId: string | null;
    updatedAt: string | null;
    state: AllianceBoardState;
  } | null;
  teamKeys: string[];
  pickLists: Array<{ id: string; name: string }>;
  shareTokens: Array<{
    id: string;
    expiresAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }>;
  message?: string;
};

function teamNumber(teamKey: string | null) {
  if (!teamKey) return "—";
  return teamKey.replace(/^frc/, "");
}

function advanceCursor(state: AllianceBoardState): Pick<AllianceBoardState, "currentSeed" | "currentSlot"> {
  const { currentSeed, currentSlot, alliances } = state;
  if (currentSlot === "captain") {
    if (currentSeed < alliances.length) return { currentSeed: currentSeed + 1, currentSlot: "captain" };
    return { currentSeed: 1, currentSlot: "first" };
  }
  if (currentSlot === "first") {
    if (currentSeed < alliances.length) return { currentSeed: currentSeed + 1, currentSlot: "first" };
    return { currentSeed: alliances.length, currentSlot: "second" };
  }
  // second picks snake reverse
  if (currentSeed > 1) return { currentSeed: currentSeed - 1, currentSlot: "second" };
  return { currentSeed: 1, currentSlot: "second" };
}

export default function DraftClient() {
  const [data, setData] = useState<DraftPayload | null>(null);
  const [state, setState] = useState<AllianceBoardState | null>(null);
  const [status, setStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    setOrgId(new URLSearchParams(window.location.search).get("orgId"));
  }, []);

  const load = useCallback(() => {
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/strategy/draft${qs}`)
      .then(async (response) => {
        const payload = await response.json();
        if (payload.status === "setup_required") {
          setSetup(payload.message ?? "Setup required");
          setData(null);
          return;
        }
        setSetup("");
        setData(payload as DraftPayload);
        setState(payload.board?.state ?? null);
      })
      .catch(() => setSetup("Could not load draft board."));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const taken = useMemo(() => {
    const keys = new Set<string>();
    for (const alliance of state?.alliances ?? []) {
      for (const key of [alliance.captainTeamKey, alliance.firstPickTeamKey, alliance.secondPickTeamKey]) {
        if (key) keys.add(key);
      }
    }
    return keys;
  }, [state]);

  const available = useMemo(
    () => (state?.availableTeamKeys ?? data?.teamKeys ?? []).filter((key) => !taken.has(key)),
    [state, data, taken],
  );

  async function persist(next: AllianceBoardState, action: "save" | "reset" = "save") {
    if (!data?.board || !data.canEdit) {
      setStatus("Owner or admin role required to edit draft day.");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/strategy/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: data.orgId,
        boardId: data.board.id,
        action,
        state: next,
        pickListId: next.pickListId,
      }),
    });
    const body = await response.json();
    setStatus(response.ok ? "Board saved." : body.error ?? "Save failed");
    setSaving(false);
    if (response.ok && body.state) setState(body.state);
    if (response.ok) load();
  }

  function assignTeam(teamKey: string) {
    if (!state || !data?.canEdit) return;
    const alliances = state.alliances.map((slot) => ({ ...slot }));
    const target = alliances.find((slot) => slot.seed === state.currentSeed);
    if (!target) return;
    const field =
      state.currentSlot === "captain"
        ? "captainTeamKey"
        : state.currentSlot === "first"
          ? "firstPickTeamKey"
          : "secondPickTeamKey";
    if (target[field]) return;
    target[field] = teamKey;
    const cursor = advanceCursor({ ...state, alliances });
    const next: AllianceBoardState = {
      ...state,
      alliances,
      availableTeamKeys: state.availableTeamKeys.filter((key) => key !== teamKey),
      ...cursor,
    };
    setState(next);
    void persist(next);
  }

  function clearSlot(seed: number, field: keyof Omit<AllianceSlot, "seed">) {
    if (!state || !data?.canEdit) return;
    const previous = state.alliances.find((slot) => slot.seed === seed)?.[field] ?? null;
    const nextAlliances = state.alliances.map((slot) => {
      if (slot.seed !== seed) return { ...slot };
      return { ...slot, [field]: null };
    });
    const next: AllianceBoardState = {
      ...state,
      alliances: nextAlliances,
      availableTeamKeys: previous
        ? [...new Set([...state.availableTeamKeys, previous])]
        : state.availableTeamKeys,
      currentSeed: seed,
      currentSlot: field === "captainTeamKey" ? "captain" : field === "firstPickTeamKey" ? "first" : "second",
    };
    setState(next);
    void persist(next);
  }

  async function createShare() {
    if (!data?.board || !data.canEdit) return;
    setSaving(true);
    const response = await fetch("/api/strategy/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: data.orgId, boardId: data.board.id, action: "share" }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setStatus(body.error ?? "Share failed");
      return;
    }
    const absolute = `${window.location.origin}${body.url}`;
    setShareUrl(absolute);
    setStatus("Mentor link created (read-only, 14 days).");
    void navigator.clipboard?.writeText(absolute);
    load();
  }

  if (setup) {
    return (
      <main className="module-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Strategy / Draft</span>
            <h1>Alliance board</h1>
            <p>{setup}</p>
          </div>
        </header>
        <a className="app-button secondary" href="/workspace">
          Open workspace
        </a>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="module-page">
        <section className="app-card">
          <h2>Loading draft day…</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="module-page strategy-draft-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Strategy / Draft</span>
          <h1>Draft day alliance board</h1>
          <p>
            {data.eventName ?? data.eventKey} · captains then first picks, then reverse second picks. Only teams with
            synced event metrics appear in the pool — no fabricated rankings.
          </p>
        </div>
        <div className="strategy-pick-actions">
          <a className="app-button secondary" href={`/strategy?orgId=${encodeURIComponent(data.orgId)}`}>
            ← Strategy
          </a>
          <a className="app-button secondary" href={`/strategy?tab=picks&orgId=${encodeURIComponent(data.orgId)}`}>
            Pick lists
          </a>
        </div>
      </header>

      {!data.board ? (
        <section className="app-card">
          <p className="app-muted">{data.message ?? "No board available."}</p>
        </section>
      ) : state ? (
        <>
          <section className="strategy-draft-toolbar app-card">
            <div>
              <span className="app-badge good">Live board</span>
              <strong>
                Now selecting: Alliance {state.currentSeed} · {state.currentSlot}
              </strong>
              <small>
                Updated {data.board.updatedAt ? new Date(data.board.updatedAt).toLocaleString() : "—"}
              </small>
            </div>
            <label>
              Linked pick list
              <select
                value={state.pickListId ?? ""}
                disabled={!data.canEdit}
                onChange={(event) => {
                  const next = { ...state, pickListId: event.target.value || null };
                  setState(next);
                  void persist(next);
                }}
              >
                <option value="">None</option>
                {data.pickLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="strategy-pick-actions">
              <button
                type="button"
                className="app-button secondary"
                disabled={!data.canEdit || saving}
                onClick={() => void persist(state, "reset")}
              >
                Reset board
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={!data.canEdit || saving}
                onClick={() => void createShare()}
              >
                Share mentor link
              </button>
            </div>
            {shareUrl ? (
              <p className="strategy-share-url">
                <span>Read-only link</span>
                <code>{shareUrl}</code>
              </p>
            ) : null}
            {status ? (
              <p className="telemetry-status success" role="status">
                {status}
              </p>
            ) : null}
            {!data.canEdit ? (
              <p className="telemetry-status" role="status">
                Read-only for your role.
              </p>
            ) : null}
          </section>

          <section className="strategy-alliance-board" aria-label="Alliance selections">
            {state.alliances.map((alliance) => (
              <article
                key={alliance.seed}
                className={`app-card strategy-alliance-card${state.currentSeed === alliance.seed ? " active" : ""}`}
              >
                <header>
                  <strong>Alliance {alliance.seed}</strong>
                  {state.currentSeed === alliance.seed ? (
                    <span className="app-badge setup">On deck · {state.currentSlot}</span>
                  ) : null}
                </header>
                <ul>
                  {(
                    [
                      ["Captain", "captainTeamKey"],
                      ["First pick", "firstPickTeamKey"],
                      ["Second pick", "secondPickTeamKey"],
                    ] as const
                  ).map(([label, field]) => (
                    <li key={field}>
                      <span>{label}</span>
                      <strong>{teamNumber(alliance[field])}</strong>
                      {alliance[field] && data.canEdit ? (
                        <button type="button" className="text-button" onClick={() => clearSlot(alliance.seed, field)}>
                          Clear
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section className="app-card strategy-draft-pool">
            <header>
              <h2>Available teams</h2>
              <small>{available.length} remaining with event metrics</small>
            </header>
            {!available.length ? (
              <p className="app-muted">Pool empty — sync more event metrics or clear a slot.</p>
            ) : (
              <ul>
                {available.map((teamKey) => (
                  <li key={teamKey}>
                    <strong>{teamNumber(teamKey)}</strong>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={!data.canEdit}
                      onClick={() => assignTeam(teamKey)}
                    >
                      Draft
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.shareTokens.length ? (
            <section className="app-card">
              <h3>Mentor share history</h3>
              <ul className="strategy-share-history">
                {data.shareTokens.map((token) => (
                  <li key={token.id}>
                    <span>
                      Expires {new Date(token.expiresAt).toLocaleString()}
                      {token.revokedAt ? " · revoked" : ""}
                    </span>
                    {!token.revokedAt && data.canEdit ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          void fetch("/api/strategy/draft", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              orgId: data.orgId,
                              action: "revoke-share",
                              tokenId: token.id,
                            }),
                          }).then(() => load());
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
