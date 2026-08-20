# Claude Code → Onshape / Fusion 360

Drive real CAD from the terminal. This is **not** the Vantage web OAuth path and **not** a second backend.

| CAD | Where it runs | What you need |
|-----|---------------|----------------|
| **Onshape** | Onshape cloud | API key pair in this terminal |
| **Fusion 360** | Your PC only | Fusion app + VantageCadRelay add-in on `127.0.0.1:32145` |

Linux: Onshape only. Autodesk Fusion is not available on Linux.

## 1. Onshape (5 minutes)

1. Open [dev-portal.onshape.com/keys](https://dev-portal.onshape.com/keys) and create an API key pair.
2. In PowerShell (this session only — do not commit):

```powershell
$env:ONSHAPE_ACCESS_KEY="your-access-key"
$env:ONSHAPE_SECRET_KEY="your-secret-key"
```

bash:

```bash
export ONSHAPE_ACCESS_KEY=your-access-key
export ONSHAPE_SECRET_KEY=your-secret-key
```

`ONSHAPE_API_KEY` / `ONSHAPE_API_SECRET` work as aliases.

3. In Onshape, create a **disposable** document and Part Studio.
4. From the repo:

```text
npx vantage-cad claude
npx vantage-cad onshape docs
npx vantage-cad onshape bind --document DID --workspace WID --element EID
npx vantage-cad onshape sketch --width 40 --height 20 --plane Top
npx vantage-cad onshape extrude --depth 10
```

Or ask Claude Code: “list my Onshape documents, bind the disposable Part Studio, sketch 40×20 mm, extrude 10 mm.”

## 2. Fusion 360 (Windows / macOS)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1
```

Then in Fusion: **Utilities → Add-Ins → Scripts and Add-Ins → run VantageCadRelay**. Keep Fusion open.

```text
npx vantage-cad fusion ping
npx vantage-cad fusion sketch --width 40 --height 20
npx vantage-cad fusion extrude --depth 10
```

## 3. Claude Code MCP

This repo includes `.mcp.json`. Restart Claude Code in the repo, or:

```text
claude mcp add vantage-cad -- node packages/vantage-cad-cli/bin/vantage-cad.mjs mcp
```

Tools: `cad_status`, `cad_setup`, `onshape_*`, `fusion_*`.

## Safety

- Use a disposable document the first time.
- Keys stay in the process environment. Session bind is `~/.vantage-cad/claude-session.json` (ids only, never secrets).
- Not certified engineering software. Fusion is never hosted on Vercel.
