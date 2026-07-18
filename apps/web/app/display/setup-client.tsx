"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DISPLAY_WIDGET_TYPES,
  PRESET_META,
  PRESET_WIDGETS,
  type DisplayWidget,
} from "../../lib/display";

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
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("next_match");
  const [widgets, setWidgets] = useState<string[]>(PRESET_WIDGETS.next_match ?? []);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [pairBoardId, setPairBoardId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/display/boards?orgId=${encodeURIComponent(orgId)}`);
    const d = await r.json();
    if (r.ok) {
      setBoards(d.boards ?? []);
      setTokens(d.tokens ?? []);
      if (!pairBoardId && d.boards?.length) setPairBoardId(d.boards[0].id);
    } else {
      setMessage(d.error ?? "Failed to load display boards");
    }
    setLoading(false);
  }, [orgId, pairBoardId]);

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
      setName("");
      await load();
    } else {
      setMessage(d.error ?? "Save failed");
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
      await load();
    } else {
      setMessage(d.error ?? "Duplicate failed");
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
      await load();
    } else {
      setMessage(d.error ?? "Token mint failed");
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
      await load();
    } else {
      setMessage(d.error ?? "Revoke failed");
    }
  }

  function copyMintedLink() {
    if (!minted) return;
    const url = `${location.origin}/display/kiosk?token=${encodeURIComponent(minted.token)}`;
    void navigator.clipboard.writeText(url);
    setMessage("Kiosk link copied to clipboard.");
  }

  const step = !boards.length ? 1 : !tokens.some((t) => !t.revokedAt) ? 2 : 3;

  return (
    <main className="display-setup">
      <header className="display-hero">
        <div>
          <span className="eyebrow">Live / Displays</span>
          <h1>Pit TV boards</h1>
          <p>
            Pick a preset, save a board, then pair a TV with a read-only token. Empty boards stay empty until
            TBA, Strategy, and Pit ops sync real data.
          </p>
        </div>
        <a href={`/workspace?orgId=${encodeURIComponent(orgId)}`}>← Workspace</a>
      </header>

      <ol className="display-steps">
        <li className={step >= 1 ? "active" : ""}>
          <strong>1. Pick preset</strong>
          Choose a competition layout or custom widgets.
        </li>
        <li className={step >= 2 ? "active" : ""}>
          <strong>2. Save board</strong>
          Name and persist the layout for your team.
        </li>
        <li className={step >= 3 ? "active" : ""}>
          <strong>3. Pair TV</strong>
          Mint a kiosk token and open fullscreen on the pit display.
        </li>
      </ol>

      {message ? (
        <p className="display-status" role="status">
          {message}
        </p>
      ) : null}

      {!loading && !boards.length ? (
        <section className="display-empty">
          <span className="app-badge setup">No boards yet</span>
          <h2>Create your first display board</h2>
          <p>
            Choose a preset below and save. Vantage will not invent match countdowns, ranks, or predictions for
            an empty board.
          </p>
        </section>
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
          className="display-form"
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
                        e.target.checked ? [...widgets, type] : widgets.filter((item) => item !== type),
                      )
                    }
                  />
                  {type.replaceAll("_", " ")}
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="display-actions">
            <button type="submit">Save board</button>
            <button type="button" onClick={resetToPreset}>
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
        <span className="eyebrow">Saved boards</span>
        {loading ? <p className="display-empty">Loading boards…</p> : null}
        {!loading && !boards.length ? null : boards.map((board) => (
          <article className="saved-board" key={board.id}>
            <div>
              <strong>{board.name}</strong>
              <small>{board.preset.replaceAll("_", " ")}</small>
            </div>
            <div className="saved-board-actions">
              <a href={`/display/kiosk?orgId=${encodeURIComponent(orgId)}&boardId=${board.id}`} target="_blank" rel="noreferrer">
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
        ))}
      </section>

      <section className="token-panel" aria-label="Pair TV">
        <span className="eyebrow">Pair TV</span>
        <p>Mint a read-only kiosk token for a saved board. The secret is shown once — copy the link before leaving this page.</p>

        {minted ? (
          <div className="token-once">
            <strong>Token shown once — copy now</strong>
            <code>{`${location.origin}/display/kiosk?token=${minted.token}`}</code>
            <button type="button" onClick={copyMintedLink}>
              Copy kiosk link
            </button>
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
            <button type="button" onClick={() => pairBoardId && void mintToken(pairBoardId)}>
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
    </main>
  );
}
