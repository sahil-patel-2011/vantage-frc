"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionMenu, EmptyState, PageHeader, Button } from "../../components/ui";
import {
  PRESET_META,
  PRESET_WIDGETS,
  type DisplayWidget,
  type DisplayWidgetType,
} from "../../lib/display";
import { displaySetupStep } from "../../lib/display/display-related";
import { hubHref } from "../../lib/nav/hubs";
import { fetchProductSession } from "../../lib/nav/product-session";
import { strategyCanSync } from "../../lib/strategy/strategy-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { DisplayWidgetEditor } from "./display-widget-editor";
import { EventBoardCard } from "./event-board-card";
import { TvLinkPanel } from "./tv-link-panel";
import {
  WIDGET_LABEL,
  fromGridLayout,
  isWidgetType,
  layoutProblem,
  matchesPreset,
  normalizeWidgets,
  toGridLayout,
} from "../../lib/display/widget-layout";

type Board = {
  id: string;
  name: string;
  preset: string;
  widgets: DisplayWidget[];
  updatedAt?: string;
};

type TokenRow = {
  id: string;
  boardId: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt?: string | null;
};

type MintedToken = {
  id: string;
  token: string;
  boardId: string;
  mode: "pit" | "stage";
};

/** The board the event board is shown through. It ignores the board's panels. */
const EVENT_BOARD_NAME = "Event board";
/** Pair TV choice: "stage:<id>" is the event board, "pit:<id>" a board the team built. */
type PairChoice = string;

function boardSummary(board: Board): string {
  if (board.name === EVENT_BOARD_NAME) return "Opens the event board";
  const panels = fromGridLayout(board.widgets).map((type) => WIDGET_LABEL[type]);
  return panels.length ? panels.join(" · ") : "No panels";
}

/** Most recently used first, then newest made: the links a pit is actually using lead. */
function linksByUse<T extends { lastUsedAt?: string | null; createdAt?: string | null }>(tokens: T[]): T[] {
  const at = (value?: string | null) => (value ? Date.parse(value) || 0 : 0);
  return [...tokens].sort((a, b) => at(b.lastUsedAt) - at(a.lastUsedAt) || at(b.createdAt) - at(a.createdAt));
}

export default function DisplaySetup({ orgId }: { orgId: string }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preset, setPreset] = useState("next_match");
  const [widgets, setWidgets] = useState<DisplayWidgetType[]>(PRESET_WIDGETS.next_match ?? []);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [showOlderLinks, setShowOlderLinks] = useState(false);
  const [pairChoice, setPairChoice] = useState<PairChoice>("");
  const [canSync, setCanSync] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchProductSession(orgId).then((session) => {
      if (cancelled) return;
      const membership = session?.memberships?.find((entry) => entry.orgId === orgId);
      setCanSync(strategyCanSync(membership?.role ?? session?.role));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const r = await fetch(`/api/display/boards?orgId=${encodeURIComponent(orgId)}`);
      const d = (await r.json()) as {
        boards?: Board[];
        tokens?: TokenRow[];
        activeEventKey?: string | null;
        error?: string;
      };
      if (!r.ok) {
        setMessage(d.error ?? "Couldn't load the Pit TV boards.");
        setMessageOk(false);
        setFetchFailed(true);
        setErrorStatus(r.status);
        setLoadError(d.error ?? "");
        return;
      }
      setBoards(d.boards ?? []);
      setTokens(d.tokens ?? []);
      setActiveEventKey(d.activeEventKey ?? null);
    } catch {
      setFetchFailed(true);
      setMessage("Network error: couldn't load the Pit TV boards.");
      setLoadError("Network error: couldn't load the Pit TV boards.");
      setMessageOk(false);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (text: string, ok: boolean) => {
    setMessage(text);
    setMessageOk(ok);
  };

  // The event board is shown through the board named "Event board", or any saved board: it
  // ignores the panels, so no special board type is needed.
  const eventCarrier = boards.find((board) => board.name === EVENT_BOARD_NAME) ?? boards[0] ?? null;
  const pairValue = pairChoice || (eventCarrier ? `stage:${eventCarrier.id}` : "");

  function choosePreset(value: string) {
    setPreset(value);
    setWidgets(normalizeWidgets(PRESET_WIDGETS[value] ?? []));
  }

  function startNewBoard() {
    setEditingId(null);
    setName("");
    choosePreset("next_match");
  }

  function editBoard(board: Board) {
    setEditingId(board.id);
    setName(board.name);
    setPreset(board.preset);
    setWidgets(fromGridLayout(board.widgets));
    document.getElementById("display-new-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function postBoard(body: Record<string, unknown>): Promise<{ id?: string; error?: string; ok: boolean }> {
    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...body }),
    });
    const d = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
    return { ...d, ok: r.ok };
  }

  async function saveBoard() {
    if (!canSync) return;
    const boardName = name.trim();
    if (!boardName) {
      say("Give the board a name first.", false);
      return;
    }
    const problem = layoutProblem(widgets);
    if (problem) {
      say(problem, false);
      return;
    }
    // A preset whose panels were changed is saved as custom so the TV draws exactly these panels.
    const result = await postBoard({
      id: editingId ?? undefined,
      name: boardName,
      preset: preset !== "custom" && !matchesPreset(widgets, preset) ? "custom" : preset,
      widgets: toGridLayout(widgets),
    });
    if (!result.ok) {
      say(result.error ?? "Couldn't save the board. Try again.", false);
      return;
    }
    // Stay on the saved board so it is clear what is being edited.
    if (result.id) setEditingId(result.id);
    say(editingId ? `Saved changes to "${boardName}".` : `Saved "${boardName}".`, true);
    await load();
  }

  async function turnOnEventBoard() {
    if (!canSync) return;
    setBusy(true);
    const result = await postBoard({
      name: EVENT_BOARD_NAME,
      preset: "event_command",
      widgets: toGridLayout(PRESET_WIDGETS.event_command ?? []),
    });
    setBusy(false);
    if (!result.ok) {
      say(result.error ?? "Couldn't turn on the event board. Try again.", false);
      return;
    }
    say("Event board is on. Open it fullscreen, or get a TV link for the pit TV.", true);
    await load();
  }

  async function duplicateBoard(board: Board) {
    if (!canSync) return;
    const copyName = `${board.name} copy`;
    const result = await postBoard({ name: copyName, preset: board.preset, widgets: toGridLayout(fromGridLayout(board.widgets)) });
    if (!result.ok) {
      say(result.error ?? "Couldn't copy the board.", false);
      return;
    }
    say(`Made "${copyName}".`, true);
    await load();
    editBoard({ ...board, id: result.id ?? board.id, name: copyName });
  }

  async function deleteBoard(board: Board) {
    if (!canSync) return;
    const r = await fetch("/api/display/boards", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, boardId: board.id }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      say(d.error ?? "Couldn't delete the board.", false);
      return;
    }
    if (editingId === board.id) startNewBoard();
    if (minted?.boardId === board.id) setMinted(null);
    say(`Deleted "${board.name}". Any TV showing it stops updating.`, true);
    await load();
  }

  const [tvName, setTvName] = useState("");

  async function mintToken(choice: PairChoice) {
    if (!canSync || !choice) return;
    const [mode, boardId] = choice.split(":") as ["pit" | "stage", string];
    // A link for this board was made on this visit and is still on screen: show it again.
    // Every click used to make another live link ("Event board · Never used" three times).
    if (minted && minted.boardId === boardId && minted.mode === mode) {
      say("Here is the TV link you just made.", true);
      return;
    }
    const board = boards.find((entry) => entry.id === boardId);
    // Named for the screen it goes on ("Pit TV", "Stands laptop"), so the list below can tell
    // links apart: they were all "Event board".
    const label = tvName.trim().slice(0, 60) || (mode === "stage" ? EVENT_BOARD_NAME : board?.name ?? "Pit TV");
    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "token", orgId, boardId, label }),
    });
    const d = (await r.json().catch(() => ({}))) as { id?: string; token?: string; error?: string };
    if (r.ok && d.token) {
      setMinted({ id: d.id ?? "", token: d.token, boardId, mode });
      // Older links for this board that no TV ever opened are turned off, so the list shows
      // the links actually in use. Links a TV has used are left alone.
      const stale = tokens.filter((t) => t.boardId === boardId && !t.revokedAt && !t.lastUsedAt && t.id !== d.id);
      for (const old of stale) {
        await fetch("/api/display/boards", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, tokenId: old.id }),
        }).catch(() => undefined);
      }
      say("TV link ready. Copy it now: it is shown only once.", true);
      await load();
    } else {
      say(d.error ?? "Couldn't make a TV link. Try again.", false);
    }
  }

  // "Get a TV link" picks the Event board and asks which screen it is for before making the
  // link: it used to make one at once, and the list filled with identical "Event board" rows.
  function getEventTvLink(boardId: string) {
    setPairChoice(`stage:${boardId}`);
    document.getElementById("display-pair")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("disp-tv-name")?.focus({ preventScroll: true }), 350);
    say("Name the screen it goes on (Pit TV, Stands laptop), then press Make TV link.", true);
  }

  async function revokeToken(tokenId: string, title: string) {
    if (!canSync) return;
    if (!window.confirm(`Turn off "${title}"? The TV using it goes blank until it gets a new link.`)) return;
    const r = await fetch("/api/display/boards", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, tokenId }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) {
      say("TV link turned off. Any TV using it stops updating.", true);
      await load();
    } else {
      say(d.error ?? "Couldn't turn that link off.", false);
    }
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const activeTokenCount = activeTokens.length;
  const step = displaySetupStep(boards.length, activeTokenCount);
  const boardName = (id: string) => boards.find((board) => board.id === id)?.name ?? null;
  const editingBoard = editingId ? boards.find((board) => board.id === editingId) ?? null : null;

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadError,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
          message: loadError || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  return (
    <main className="module-page display-setup">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/competition", "command", orgId)}>Competition</a>
            {" / "}
            <a href={hubHref("/competition", "match-checklist", orgId)}>Pit</a>
            {" / Pit TV"}
          </>
        }
        title="Pit TV"
        description="Pick what the pit TV shows, save it, then open the TV link on the TV."
      />

      {message ? (
        <p className={`display-status${messageOk ? " ok" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {failure ? (
        <EmptyState soft title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div className="disp-stack">
          {/* Once a TV link is live the three ticks greeted people who had done nothing yet, as if
              the page were already finished for them: say it plainly instead. */}
          {step >= 3 ? (
            <p className="disp-progress-done" role="status">
              A TV already shows a board. To add another screen, make a TV link below and name it.
            </p>
          ) : (
            <ol className="disp-progress" aria-label="Pit TV setup steps">
              <li className={step >= 1 ? "is-done" : undefined}>Pick a board</li>
              <li className={step >= 2 ? "is-done" : undefined}>Save it</li>
              <li>Open the TV link on the TV</li>
            </ol>
          )}

          {!loading && !activeEventKey ? (
            <EmptyState
              soft
              title="No event set yet"
              description="Pick the event you are at on Event day. The pit TV fills in once its schedule is in."
            >
              <Button as="a" variant="secondary" href={hubHref("/competition", "command", orgId)}>
                Open Event day
              </Button>
            </EmptyState>
          ) : null}

          {loading && !boards.length ? (
            <p className="display-empty">Loading boards…</p>
          ) : (
            <EventBoardCard
              orgId={orgId}
              boardId={eventCarrier?.id ?? null}
              canSync={canSync}
              busy={busy}
              onCreate={() => void turnOnEventBoard()}
              onGetTvLink={getEventTvLink}
            />
          )}

          {/* Folded under the recommended event board: the whole editor used to sit open right
              below it. It opens while a board is being edited. */}
          <details className="disp-build-fold" open={Boolean(editingId) || undefined}>
            <summary>Build your own board</summary>
          <section className="disp-build" aria-labelledby="disp-build-title">
            <header className="disp-section-head">
              <h2 id="disp-build-title">Build your own</h2>
              <p>Choose the panels yourself. Panel 1 is shown large; the rest stack beside it.</p>
            </header>

            <div className="preset-picker" role="group" aria-label="Start from">
              {PRESET_META.map(({ id, title, copy }) => (
                <button
                  key={id}
                  type="button"
                  className={preset === id ? "active" : ""}
                  aria-pressed={preset === id}
                  onClick={() => choosePreset(id)}
                >
                  <strong>{title}</strong>
                  <span>{copy}</span>
                </button>
              ))}
            </div>

            <div className="display-editor">
              <form
                id="display-new-board"
                className="display-form soft-panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveBoard();
                }}
              >
                {editingBoard ? (
                  <p className="disp-editing">
                    Editing: <strong>{editingBoard.name}</strong>{" "}
                    <button type="button" className="text-button" onClick={startNewBoard}>
                      Start a new board
                    </button>
                  </p>
                ) : null}
                <label>
                  Board name
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Coach TV"
                    required
                  />
                </label>

                <DisplayWidgetEditor widgets={widgets} onChange={setWidgets} />

                <div className="display-actions">
                  {canSync ? (
                    <Button variant="primary" type="submit">
                      {editingBoard ? "Save changes" : "Save board"}
                    </Button>
                  ) : (
                    <p className="app-muted">An owner or admin saves boards. You can still open a saved board fullscreen.</p>
                  )}
                  {preset !== "custom" && !matchesPreset(widgets, preset) ? (
                    <Button variant="secondary" type="button" onClick={() => choosePreset(preset)}>
                      Undo my panel changes
                    </Button>
                  ) : null}
                </div>
              </form>

              <section className="display-preview" aria-label="How the TV will look">
                <span>HOW THE TV WILL LOOK</span>
                <h2>{name.trim() || "New board"}</h2>
                <div className={`display-preview-grid${widgets.length > 1 ? "" : " is-single"}`}>
                  {widgets.length ? (
                    <>
                      <article className="is-hero">
                        <strong>{WIDGET_LABEL[widgets[0]!]}</strong>
                        <small>
                          {widgets[0] === "next_match"
                            ? "Match, countdown, bumper colour, with us / against us"
                            : "Shown large"}
                        </small>
                      </article>
                      {widgets.length > 1 ? (
                        <div className="display-preview-stack">
                          {widgets.slice(1).map((item) => (
                            <article key={item}>
                              <strong>{isWidgetType(item) ? WIDGET_LABEL[item] : item}</strong>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <article>
                      <strong>No panels</strong>
                      <small>Add a panel on the left</small>
                    </article>
                  )}
                </div>
              </section>
            </div>
          </section>
          </details>

          {boards.length ? (
            <section className="saved-boards" aria-labelledby="disp-saved-title">
              <header className="disp-section-head">
                <h2 id="disp-saved-title">Saved boards</h2>
              </header>
              {boards.map((board) => {
                const eventBoard = board.name === EVENT_BOARD_NAME;
                const href = `/display/pit?orgId=${encodeURIComponent(orgId)}&boardId=${board.id}`;
                // The board named "Event board" opens as the event board, not as its panels.
                const openHref = eventBoard ? href.replace("/display/pit", "/display/stage") : href;
                return (
                  <article className={`disp-board-row${editingId === board.id ? " is-editing" : ""}`} key={board.id}>
                    <div className="disp-board-text">
                      <strong>{board.name}</strong>
                      <small>{boardSummary(board)}</small>
                    </div>
                    <ActionMenu
                      label={`${board.name} actions`}
                      tone="row"
                      maxSecondary={0}
                      triggerTestId={`board-menu-${board.id}`}
                      actions={[
                        { id: "open", label: "Open fullscreen", href: openHref, intent: "primary" },
                        ...(canSync
                          ? [
                              ...(eventBoard ? [] : [{ id: "edit", label: "Edit", onClick: () => editBoard(board) }]),
                              { id: "duplicate", label: "Duplicate", onClick: () => void duplicateBoard(board) },
                              {
                                id: "delete",
                                label: "Delete",
                                hint: "Its TV links stop working",
                                intent: "destructive" as const,
                                onClick: () => void deleteBoard(board),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </article>
                );
              })}
            </section>
          ) : null}

          <section id="display-pair" className="token-panel soft-panel" aria-labelledby="disp-pair-title">
            <header className="disp-section-head">
              <h2 id="disp-pair-title">Put it on the TV</h2>
              <p>
                A TV link shows one board on a TV that isn&rsquo;t signed in. It can only show that board, and you can turn it
                off here at any time.
              </p>
            </header>

            {canSync && boards.length ? (
              <div className="display-actions disp-pair-row">
                <label>
                  Show
                  <select value={pairValue} onChange={(e) => setPairChoice(e.target.value)}>
                    {eventCarrier ? <option value={`stage:${eventCarrier.id}`}>Event board (recommended)</option> : null}
                    {boards
                      .filter((board) => board.name !== EVENT_BOARD_NAME)
                      .map((board) => (
                        <option key={board.id} value={`pit:${board.id}`}>
                          {board.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Which screen <small className="app-muted">optional</small>
                  <input
                    id="disp-tv-name"
                    value={tvName}
                    maxLength={60}
                    placeholder="e.g. Pit TV, Stands laptop"
                    onChange={(e) => setTvName(e.target.value)}
                  />
                </label>
                <Button variant="primary" type="button" onClick={() => void mintToken(pairValue)}>
                  Make TV link
                </Button>
              </div>
            ) : null}

            {minted ? (
              <TvLinkPanel
                token={minted.token}
                mode={minted.mode}
                boardName={boardName(minted.boardId) ?? undefined}
                onCopied={(text) => say(text, !/couldn/i.test(text))}
              />
            ) : null}

            {activeTokens.length ? (
              <div className="token-list">
                {/* The three most recently used; the rest fold away. Every link ever made was a
                    14-row list of "Turn off" buttons. */}
                {(showOlderLinks ? linksByUse(activeTokens) : linksByUse(activeTokens).slice(0, 3)).map((token) => {
                  // An event-board link rides on a saved board but shows the event board, so it
                  // must not say it shows that board ("Event board · Shows 'Coach TV'").
                  const eventLink = token.label === EVENT_BOARD_NAME || (eventCarrier != null && token.boardId === eventCarrier.id);
                  const shows = eventLink ? null : boardName(token.boardId);
                  const title = token.label && token.label !== "Pit TV" ? token.label : shows ?? "Pit TV";
                  return (
                    <div className={`token-row${token.revokedAt ? " revoked" : ""}`} key={token.id}>
                      <div>
                        <strong>{title}</strong>
                        <small>
                          {eventLink && title !== EVENT_BOARD_NAME ? `${EVENT_BOARD_NAME} · ` : ""}
                          {shows && shows !== title ? `Shows "${shows}" · ` : ""}
                          {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}` : "Never used"}
                          {/* Two links with the same name still differ by when they were made. */}
                          {token.createdAt ? ` · Made ${new Date(token.createdAt).toLocaleDateString()}` : ""}
                        </small>
                      </div>
                      {canSync ? (
                        <button type="button" className="text-button" onClick={() => void revokeToken(token.id, title)}>
                          Turn off
                        </button>
                      ) : (
                        <span>On</span>
                      )}
                    </div>
                  );
                })}
                {activeTokens.length > 3 && !showOlderLinks ? (
                  <button type="button" className="text-button" onClick={() => setShowOlderLinks(true)}>
                    Older links ({activeTokens.length - 3})
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="display-empty">
                {canSync
                  ? "No TV links on yet. Make one above once a board is saved."
                  : "No TV links on yet. An owner or admin makes one."}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
