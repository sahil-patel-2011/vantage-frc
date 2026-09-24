"use client";

import { useCallback, useEffect, useState } from "react";
import { DisplayRelated } from "../../components/display-related";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  PRESET_META,
  PRESET_WIDGETS,
  type DisplayWidget,
  type DisplayWidgetType,
} from "../../lib/display";
import {
  DISPLAY_RELATED_INCLUDE,
  displaySetupStep,
} from "../../lib/display/display-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { fetchProductSession } from "../../lib/nav/product-session";
import { strategyCanSync } from "../../lib/strategy/strategy-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

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
};

type MintedToken = {
  id: string;
  token: string;
  boardId: string;
  label: string;
};

import { DisplayWidgetEditor } from "./display-widget-editor";
import { TvLinkPanel } from "./tv-link-panel";
import {
  WIDGET_LABEL,
  fromGridLayout,
  layoutProblem,
  matchesPreset,
  normalizeWidgets,
  toGridLayout,
} from "../../lib/display/widget-layout";

export default function DisplaySetup({ orgId }: { orgId: string }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("next_match");
  const [widgets, setWidgets] = useState<DisplayWidgetType[]>(
    PRESET_WIDGETS.next_match ?? [],
  );
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [pairBoardId, setPairBoardId] = useState("");
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
        setMessage(d.error ?? "Failed to load display boards");
        setMessageOk(false);
        setFetchFailed(true);
        setErrorStatus(r.status);
        setLoadError(d.error ?? "");
        return;
      }
      setBoards(d.boards ?? []);
      setTokens(d.tokens ?? []);
      setActiveEventKey(d.activeEventKey ?? null);
      setPairBoardId((prev) => prev || d.boards?.[0]?.id || "");
    } catch {
      setFetchFailed(true);
      setMessage("Network error — could not load display boards.");
      setLoadError("Network error — could not load display boards.");
      setMessageOk(false);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function choosePreset(value: string) {
    setPreset(value);
    setWidgets(normalizeWidgets(PRESET_WIDGETS[value] ?? []));
  }

  function resetToPreset() {
    setWidgets(normalizeWidgets(PRESET_WIDGETS[preset] ?? []));
  }

  async function saveBoard(editId?: string) {
    if (!canSync) return;
    const boardName = name.trim();
    if (!boardName) {
      setMessage("Board name is required");
      setMessageOk(false);
      return;
    }
    const problem = layoutProblem(widgets);
    if (problem) {
      setMessage(problem);
      setMessageOk(false);
      return;
    }
    const layout: DisplayWidget[] = toGridLayout(widgets);
    // A preset draws its own fixed screen on the TV; only "custom" draws the panels. So a
    // preset whose panels were changed is saved as custom, or the TV ignored the edit.
    const body: Record<string, unknown> = {
      orgId,
      name: boardName,
      preset: preset !== "custom" && !matchesPreset(widgets, preset) ? "custom" : preset,
      widgets: layout,
    };
    if (editId) body.id = editId;

    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.ok) {
      setMessage(editId ? "Display board updated." : "Display board saved.");
      setMessageOk(true);
      setName("");
      await load();
    } else {
      setMessage(d.error ?? "Save failed");
      setMessageOk(false);
    }
  }

  async function duplicateBoard(board: Board) {
    if (!canSync) return;
    setName(`${board.name} copy`);
    setPreset(board.preset);
    setWidgets(fromGridLayout(board.widgets));
    const layout: DisplayWidget[] = board.widgets.map((w, index) => ({
      type: w.type,
      x: w.x ?? (index % 2) * 6,
      y: w.y ?? Math.floor(index / 2) * 4,
      w: w.w ?? 6,
      h: w.h ?? 4,
    }));
    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, name: `${board.name} copy`, preset: board.preset, widgets: layout }),
    });
    const d = await r.json();
    if (r.ok) {
      setMessage("Duplicate board created.");
      setMessageOk(true);
      await load();
    } else {
      setMessage(d.error ?? "Duplicate failed");
      setMessageOk(false);
    }
  }

  async function mintToken(boardId: string) {
    if (!canSync) return;
    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "token", orgId, boardId, label: "Pit TV" }),
    });
    const d = await r.json();
    if (r.ok) {
      setMinted({ id: d.id, token: d.token, boardId, label: "Pit TV" });
      setMessage("TV link ready. Copy it now: it is shown only once.");
      setMessageOk(true);
      await load();
    } else {
      setMessage(d.error ?? "Couldn't make a TV link. Try again.");
      setMessageOk(false);
    }
  }

  async function revokeToken(tokenId: string) {
    if (!canSync) return;
    const r = await fetch("/api/display/boards", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, tokenId }),
    });
    const d = await r.json();
    if (r.ok) {
      setMessage("TV link turned off. Any TV using it stops updating.");
      setMessageOk(true);
      await load();
    } else {
      setMessage(d.error ?? "Revoke failed");
      setMessageOk(false);
    }
  }

  const activeTokenCount = tokens.filter((t) => !t.revokedAt).length;
  const step = displaySetupStep(boards.length, activeTokenCount);

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadError,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message:
            loadError ||
            "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  return (
    <main className="module-page display-setup">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/workspace", orgId)}>Your team</a>
            {" / Displays"}
          </>
        }
        title="Pit TV boards"
        description="Pick a preset, save a board, then pair a TV or Raspberry Pi with a read-only token. Empty boards stay empty until TBA, Strategy, and Pit ops sync real data."
      />

      <div className="disp-related">
        <DisplayRelated orgId={orgId} include={[...DISPLAY_RELATED_INCLUDE]} />
      </div>

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

          <section className="display-steps" aria-label="Display setup steps">
            <article className={step >= 1 ? "active" : undefined}>
              <span>Step 1</span>
              <strong>Pick preset</strong>
              <p>Choose a competition layout or custom widgets.</p>
            </article>
            <article className={step >= 2 ? "active" : undefined}>
              <span>Step 2</span>
              <strong>Save board</strong>
              <p>Name and persist the layout for your team.</p>
            </article>
            <article className={step >= 3 ? "active" : undefined}>
              <span>Step 3</span>
              <strong>Pair TV</strong>
              <p>Make a TV link and open it full screen on the pit TV.</p>
            </article>
          </section>

          {!loading && !activeEventKey ? (
            <EmptyState
              soft
              title="No active event yet"
              description="Set an Event Day event so next-match and coverage can read official scores. Boards stay blank until then."
            >
              <Button as="a" variant="primary" href={hubHref("/competition", "command", orgId)}>
                Open Event Day
              </Button>
            </EmptyState>
          ) : null}

          {!loading && !boards.length ? (
            <EmptyState
              soft
              title="Create your first display board"
              description={
                canSync
                  ? "Choose a preset below and save. Countdowns, ranks, and predictions stay blank until this board has an event."
                  : "An owner or admin saves a board and mints a pit TV token. Fullscreen stays available."
              }
            >
              {canSync ? (
              <Button as="a" variant="primary" href="#display-new-board">
                Name this board
              </Button>
              ) : null}
            </EmptyState>
          ) : null}

          <section className="preset-picker" aria-label="Display presets">
            {PRESET_META.map(({ id, title, copy }) => (
              <button
                key={id}
                type="button"
                className={preset === id ? "active" : ""}
                onClick={() => choosePreset(id)}
              >
                <strong>{title}</strong>
                <span>{copy}</span>
              </button>
            ))}
          </section>

          <section className="display-editor">
            <form
              id="display-new-board"
              className="display-form soft-panel"
              onSubmit={(e) => {
                e.preventDefault();
                void saveBoard();
              }}
            >
              <label>
                Board name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pit TV"
                  required
                />
              </label>

              {/* Shown for every preset, not only "custom". A preset is where a
                  team starts, not what they are stuck with, and hiding this
                  behind one option meant four of the five layouts could not be
                  touched at all. */}
              <DisplayWidgetEditor widgets={widgets} onChange={setWidgets} />
              {preset !== "custom" && !matchesPreset(widgets, preset) ? (
                <p className="app-muted dwe-customised">
                  Customised from the {preset.replaceAll("_", " ")} preset, so the TV will show exactly these
                  panels. Reset to preset puts the preset&rsquo;s screen back.
                </p>
              ) : null}

              <div className="display-actions">
                {canSync ? (
                <Button variant="primary" type="submit">
                  Save board
                </Button>
                ) : (
                <p className="app-muted">An owner or admin saves a board and mints a pit TV token. You can still open a saved board fullscreen.</p>
                )}
                <Button variant="secondary" type="button" onClick={resetToPreset}>
                  Reset to preset
                </Button>
              </div>
            </form>

            <section className="display-preview" aria-label="Board preview">
              <span>16:9 PREVIEW · ONE LAYOUT</span>
              <h2>{name.trim() || "Untitled board"}</h2>
              <div className="display-preview-grid">
                {widgets.length ? (
                  widgets.map((item, index) => (
                    <article key={item}>
                      <strong>{WIDGET_LABEL[item] ?? item.replaceAll("_", " ")}</strong>
                      {/* Only the first panel gets a caption. "Authorized module
                          data only" was on every one of them: internal policy
                          language, repeated, telling a mentor nothing about the
                          board they are arranging. */}
                      {index === 0 ? <small>Top left — read first</small> : null}
                    </article>
                  ))
                ) : (
                  <article>
                    <strong>No widgets</strong>
                    <small>Choose a preset or add widgets</small>
                  </article>
                )}
              </div>
            </section>
          </section>

          <section className="saved-boards">
            <header className="disp-section-head">
              <span className="eyebrow">Saved boards</span>
              <p>Fullscreen and tokens only work for boards you saved — nothing is pre-populated.</p>
            </header>
            {loading ? <p className="display-empty">Loading boards…</p> : null}
            {!loading && !boards.length ? null : (
              boards.map((board) => (
                <article className="saved-board" key={board.id}>
                  <div>
                    <strong>{board.name}</strong>
                    <small>{board.preset.replaceAll("_", " ")}</small>
                  </div>
                  <div className="saved-board-actions">
                    <a
                      href={`/display/pit?orgId=${encodeURIComponent(orgId)}&boardId=${board.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open fullscreen
                    </a>
                    {canSync ? (
                    <>
                    <button type="button" onClick={() => void duplicateBoard(board)}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => void mintToken(board.id)}>
                      Make TV link
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setName(board.name);
                        setPreset(board.preset);
                        setWidgets(fromGridLayout(board.widgets));
                        void saveBoard(board.id);
                      }}
                    >
                      Update
                    </button>
                    </>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="token-panel soft-panel" aria-label="Pair TV">
            <header className="disp-section-head">
              <span className="eyebrow">Pair TV</span>
              <p>
                A TV link shows a saved board on a TV that isn't signed in. It can only show the board, and
                you can turn it off here at any time.
              </p>
            </header>

            {minted ? (
              <TvLinkPanel
                token={minted.token}
                onCopied={(text) => {
                  setMessage(text);
                  setMessageOk(!/couldn/i.test(text));
                }}
              />
            ) : null}

            {canSync && boards.length ? (
              <div className="display-actions" style={{ marginBottom: "1rem" }}>
                <label>
                  Board to show
                  <select
                    value={pairBoardId}
                    onChange={(e) => setPairBoardId(e.target.value)}
                    style={{ marginLeft: "0.5rem" }}
                  >
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="primary" type="button" onClick={() => pairBoardId && void mintToken(pairBoardId)}>
                  Make TV link
                </Button>
              </div>
            ) : null}

            {tokens.length ? (
              <div>
                {tokens.map((token) => (
                  <div className={`token-row${token.revokedAt ? " revoked" : ""}`} key={token.id}>
                    <div>
                      <strong>{token.label}</strong>
                      <small>
                        {token.revokedAt
                          ? `Revoked ${new Date(token.revokedAt).toLocaleString()}`
                          : token.lastUsedAt
                            ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                            : "Never used"}
                      </small>
                    </div>
                    {!token.revokedAt && canSync ? (
                      <button type="button" onClick={() => void revokeToken(token.id)}>
                        Turn off
                      </button>
                    ) : token.revokedAt ? (
                      <span>Revoked</span>
                    ) : (
                      <span>Active</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="display-empty">
                {canSync
                  ? "No kiosk tokens yet. Mint one after saving a board."
                  : "No kiosk tokens yet. An owner or admin mints one after saving a board."}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

