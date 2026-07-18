# Vantage for FRC (VS Code)

Connect your local robot-code editor to [Vantage](https://vantagefrc.com) so the assistant can use **opt-in** context: open file, selection, language, and optional Problems diagnostics.

**Package path:** `packages/vantage-vscode`

## Install from VSIX

### Windows

1. Build (from repo root or this folder):
   ```powershell
   cd packages/vantage-vscode
   npm install
   npm run package
   ```
2. In VS Code / Cursor: **Extensions** → `⋯` → **Install from VSIX…** → choose `vantage-vscode.vsix`.
3. Or CLI:
   ```powershell
   code --install-extension .\vantage-vscode.vsix
   ```
   (Cursor: `cursor --install-extension .\vantage-vscode.vsix`)

### macOS

```bash
cd packages/vantage-vscode
npm install
npm run package
code --install-extension ./vantage-vscode.vsix
# or: cursor --install-extension ./vantage-vscode.vsix
```

### Linux

```bash
cd packages/vantage-vscode
npm install
npm run package
code --install-extension ./vantage-vscode.vsix
```

Reload the window after install.

## Pair flow

1. Set **Vantage: Base Url** if needed (`vantage.baseUrl`):
   - Production: `https://vantagefrc.com` (default)
   - Local web: `http://localhost:3001`
2. Command Palette → **Vantage: Sign In / Pair**
3. Extension shows a short code and opens `/editor/pair?code=…`
4. Sign in on the web app, pick your **organization**, approve
5. Extension polls until approved; status bar shows `Vantage: <org name>`

To switch orgs: **Vantage: Sign Out**, then pair again and choose a different org on the approve page.

### Offline / API-not-ready mock

Enable setting **`vantage.mockPairing`**. Shares still require the same preview confirm; deep links open the configured base URL with a mock org id.

## Commands

| Command | Action |
|---------|--------|
| Vantage: Sign In / Pair | Device-code connect |
| Vantage: Sign Out | Revoke + clear local token |
| Vantage: Ask About Selection | Preview → opt-in share → open Chat |
| Vantage: Review Current File | Preview → opt-in share of current file |
| Vantage: Open Web Chat / Code | Deep link with `orgId` + `source=vscode` |
| Vantage: Privacy & What Gets Shared | Local privacy notes |

## Privacy

- Nothing is uploaded until you confirm a **share preview**.
- Only the fields in that preview are sent (never the whole repo).
- Device token lives in VS Code **Secret Storage**.

API contract for server/GitHub agents: see `CONTRACT.md` in this package.

## Develop

```bash
npm install
npm run compile   # or npm run watch
# F5 in a VS Code Extension Development Host, or install the vsix
```

Server migration: `packages/db/migrations/0114_editor_pairing.sql`  
Pair UI: `/editor/pair`  
APIs: `/api/editor/pair/*`, `/api/editor/session`, `/api/editor/context`
