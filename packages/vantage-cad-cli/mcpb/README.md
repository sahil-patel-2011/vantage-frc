# Browser-only MCP desktop extension

The source manifest uses the official [MCPB format](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md).
Its Node entry imports `onshape-ui/runtime.ts` directly. It never dispatches the
legacy `mcp`, `login`, `setup` or `onshape` commands. Only Vantage access checks use
HTTP; Onshape interaction remains visible browser UI work.

`scripts/cad/bundle-onshape-mcpb.mjs` stages one extension from the existing
`apps/desktop/resources/onshape-ui/<platform>-<arch>/` bundle. It does not install
dependencies, download a browser, open clients or generate an archive. Run it only
in an authorized release environment after staging the approved browser assets.
Each target gets its own `dist/onshape-mcpb/<platform>-<arch>/` directory. The entry
checks the packaged manifest and resolved browser path before launch; it refuses
wrong-architecture bundles and executable paths outside the extension.

The release operator must validate, pack and sign the staged directory with the
already provisioned [official MCPB tooling](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md).
No automatic workflow or install hook invokes this recipe. The output remains a
development candidate until it passes clean-machine macOS/Windows acceptance.
Preserve executable permissions and Chromium framework symlinks in the archive.
Confirm actual browser launch and cleanup after installation; a ZIP alone is not
evidence that the target client preserves the required layout.

Claude's desktop-extension format provides a bundled Node runtime; verify the
accepted client's runtime satisfies the declared Node 22 requirement. Other local
MCP clients may need their own import adapter. No universal ChatGPT/Claude version
compatibility is implied by providing an MCPB manifest.

MCP initialization performs no pairing, resource lookup or browser launch.
Explicit status, pair-start, pair-check, start and stop tools guide setup. Pairing
uses the existing Vantage protocol, holds its polling secret in memory only, and
checks just once per user-requested tool call. It verifies the server-issued
device identity and Onshape platform before saving, then requires separate
current Browser CAD approval. Credential values never appear in tool output.

Existing device pairing is loaded from the current Vantage credential store, not
from extension configuration. If the authorized release host has the optional
native `keytar` adapter, the recipe copies it; validate its target architecture
and native dependencies before shipping. Windows refuses to save new pairings
without the native vault adapter because POSIX file mode does not establish a
private Windows ACL. macOS can use the existing permission-restricted credential
file fallback. Do not copy any user's credential file into the release. Installing
the extension does not grant pilot access; guided pairing and approval still need
target-client and hosted acceptance.

Before distribution, review the privacy policy URLs, installed-client consent
screen, membership/revocation behavior, current-session MFA, dependency licenses,
signed browser binaries, connector termination and a disposable CAD workflow.
The extension sends visible CAD observations to the user's selected AI client.
The guide must ship with the package; do not advertise a release download before
an accepted and signed artifact actually exists.
