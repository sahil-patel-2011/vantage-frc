"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DisplayRelated } from "../../components/display-related";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import {
  DISPLAY_WIDGET_TYPES,
  PRESET_META,
  PRESET_WIDGETS,
  displayKioskHref,
  pitChromiumKioskCommand,
  type DisplayKioskMode,
  type DisplayWidget,
} from "../../lib/display";
import {
  DISPLAY_RELATED_INCLUDE,
  displaySetupNextActions,
  displaySetupStep,
} from "../../lib/display/display-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
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

export default function DisplaySetup({ orgId }: { orgId: string }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("next_match");
  const [widgets, setWidgets] = useState<string[]>(PRESET_WIDGETS.next_match ?? []);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [pairBoardId, setPairBoardId] = useState("");

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
    setWidgets(PRESET_WIDGETS[value] ?? []);
  }

  function resetToPreset() {
    setWidgets(PRESET_WIDGETS[preset] ?? []);
  }

  async function saveBoard(editId?: string) {
    const boardName = name.trim();
    if (!boardName) {
      setMessage("Board name is required");
      setMessageOk(false);
      return;
    }
    const layout: DisplayWidget[] = widgets.map((type, index) => ({
      type,
      x: (index % 2) * 6,
      y: Math.floor(index / 2) * 4,
      w: 6,
      h: 4,
    }));
    const body: Record<string, unknown> = {
      orgId,
      name: boardName,
      preset,
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
    setName(`${board.name} copy`);
    setPreset(board.preset);
    setWidgets(board.widgets.map((w) => String(w.type)));
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
    const r = await fetch("/api/display/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "token", orgId, boardId, label: "Pit TV" }),
    });
    const d = await r.json();
    if (r.ok) {
      setMinted({ id: d.id, token: d.token, boardId, label: "Pit TV" });
      setMessage("Kiosk token minted — copy it now. It will not be shown again.");
      setMessageOk(true);
      await load();
    } else {
      setMessage(d.error ?? "Token mint failed");
      setMessageOk(false);
    }
  }

  async function revokeToken(tokenId: string) {
    const r = await fetch("/api/display/boards", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, tokenId }),
    });
    const d = await r.json();
    if (r.ok) {
      setMessage("Token revoked.");
      setMessageOk(true);
      await load();
    } else {
      setMessage(d.error ?? "Revoke failed");
      setMessageOk(false);
    }
  }

  const MINTED_LINK_COPY: Record<DisplayKioskMode, string> = {
    pit: "Pit / Pi display link copied.",
    kiosk: "Kiosk link copied to clipboard.",
    stage: "Event display link copied — the board follows the event phase on its own.",
  };

  function copyMintedLink(mode: DisplayKioskMode = "pit") {
    if (!minted) return;
    const url = displayKioskHref(location.origin, minted.token, mode);
    void navigator.clipboard.writeText(url);
    setMessage(MINTED_LINK_COPY[mode]);
    setMessageOk(true);
  }

  const activeTokenCount = tokens.filter((t) => !t.revokedAt).length;
  const step = displaySetupStep(boards.length, activeTokenCount);
  const nextActions = useMemo(
    () =>
      displaySetupNextActions({
        orgId,
        boardCount: boards.length,
        activeTokenCount,
        hasActiveEvent: loading ? null : Boolean(activeEventKey),
      }),
    [orgId, boards.length, activeTokenCount, loading, activeEventKey],
  );

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
            "A network or server issue prevented loading. Try again — nothing was filled with DEMO layouts.",
        },
      )
    : null;

  return (
    <main className="module-page display-setup">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/workspace", orgId)}>Workspace</a>
            {" / Displays"}
          </>
        }
        title="Pit TV boards"
        description="Pick a preset, save a board, then pair a TV or Raspberry Pi with a read-only token. Empty boards stay empty until TBA, Strategy, and Pit ops sync real data — never DEMO matches or ranks."
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
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : (
        <div className="disp-stack">
          <NextActionsPanel actions={nextActions} />

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
              <p>Mint a kiosk token and open fullscreen on the pit display or a Pi stick.</p>
            </article>
          </section>

          {!loading && !activeEventKey ? (
            <EmptyState
              soft
              badge="Setup"
              badgeTone="setup"
              title="No active event yet"
              description="Set an Event Day active event so next-match and coverage widgets can read real TBA rows. Boards will not invent a schedule."
            >
              <a className="app-button" href={hubHref("/competition", "command", orgId)}>
                Open Event Day
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "strategy", orgId)}>
                Open Strategy
              </a>
            </EmptyState>
          ) : null}

          {!loading && !boards.length ? (
            <EmptyState
              soft
              badge="No boards yet"
              badgeTone="setup"
              title="Create your first display board"
              description="Choose a preset below and save. Vantage will not invent match countdowns, ranks, or predictions for an empty board."
            />
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

              {preset === "custom" ? (
                <fieldset>
                  <legend>Widgets</legend>
                  {DISPLAY_WIDGET_TYPES.map((type) => (
                    <label className="check-field" key={type}>
                      <input
                        type="checkbox"
                        checked={widgets.includes(type)}
                        onChange={(e) =>
                          setWidgets(
                            e.target.checked
                              ? [...widgets, type]
                              : widgets.filter((item) => item !== type),
                          )
                        }
                      />
                      {type.replaceAll("_", " ")}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <div className="display-actions">
                <button type="submit" className="app-button">
                  Save board
                </button>
                <button type="button" className="app-button secondary" onClick={resetToPreset}>
                  Reset to preset
                </button>
              </div>
            </form>

            <section className="display-preview" aria-label="Board preview">
              <span>16:9 PREVIEW · ONE LAYOUT</span>
              <h2>{name.trim() || "Untitled board"}</h2>
              <div className="display-preview-grid">
                {widgets.length ? (
                  widgets.map((item) => (
                    <article key={item}>
                      <strong>{item.replaceAll("_", " ")}</strong>
                      <small>Authorized module data only</small>
                    </article>
                  ))
                ) : (
                  <article>
                    <strong>No widgets</strong>
                    <small>Select a preset or custom widgets</small>
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
                    <button type="button" onClick={() => void duplicateBoard(board)}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => void mintToken(board.id)}>
                      Mint TV token
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setName(board.name);
                        setPreset(board.preset);
                        setWidgets(board.widgets.map((w) => String(w.type)));
                        void saveBoard(board.id);
                      }}
                    >
                      Update
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="token-panel soft-panel" aria-label="Pair TV">
            <header className="disp-section-head">
              <span className="eyebrow">Pair TV</span>
              <p>
                Mint a read-only kiosk token for a saved board. The secret is shown once — copy the
                link before leaving this page.
              </p>
            </header>

            {minted ? (
              <div className="token-once">
                <strong>Token shown once — copy now</strong>
                <code>{displayKioskHref(location.origin, minted.token, "pit")}</code>
                <p>
                  Raspberry Pi / Chromium kiosk:{" "}
                  <code>{pitChromiumKioskCommand(displayKioskHref(location.origin, minted.token, "pit"))}</code>
                </p>
                <p>
                  Event display (auto-advances through pre-event, quals, alliance selection,
                  playoffs, and thanks):{" "}
                  <code>{displayKioskHref(location.origin, minted.token, "stage")}</code>
                </p>
                <div className="display-actions">
                  <button type="button" className="app-button" onClick={() => copyMintedLink("pit")}>
                    Copy pit / Pi link
                  </button>
                  <button type="button" className="app-button secondary" onClick={() => copyMintedLink("stage")}>
                    Copy event display link
                  </button>
                  <button type="button" className="app-button secondary" onClick={() => copyMintedLink("kiosk")}>
                    Copy standard kiosk link
                  </button>
                </div>
              </div>
            ) : null}

            {boards.length ? (
              <div className="display-actions" style={{ marginBottom: "1rem" }}>
                <label>
                  Board for new token
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
                <button
                  type="button"
                  className="app-button"
                  onClick={() => pairBoardId && void mintToken(pairBoardId)}
                >
                  Mint token
                </button>
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
                    {!token.revokedAt ? (
                      <button type="button" onClick={() => void revokeToken(token.id)}>
                        Revoke
                      </button>
                    ) : (
                      <span>Revoked</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="display-empty">No kiosk tokens yet. Mint one after saving a board.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function NextActionsPanel({
  actions,
}: {
  actions: ReturnType<typeof displaySetupNextActions>;
}) {
  if (actions.length === 0) return null;
  return (
    <Panel className="disp-next-actions">
      <header>
        <h2>Next actions</h2>
        <p>Real Event Day and Strategy paths only — boards stay blank until TBA and scored data exist.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
