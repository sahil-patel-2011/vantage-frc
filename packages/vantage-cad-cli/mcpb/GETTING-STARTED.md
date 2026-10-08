# Vantage CAD — Team 6925 pilot

This extension is a development candidate. It is not yet a signed, tested download.
Use only a team-approved release matching your computer and AI desktop app.

## Connect

1. Open the approved `.mcpb` file in a desktop AI app that supports local MCP
   extensions, and review its permissions. The package includes its browser and
   dependencies; it does not ask for your Onshape password or a pasted device token.
2. Ask: **“Set up Vantage CAD on this computer.”** Your assistant checks status and,
   if needed, gives you a Vantage pairing link. Open it yourself, sign in, choose
   your Team 6925 organization and **Onshape**, then approve. Tell the assistant
   when you finish so it can check once and save the approval.
3. Follow the separate **Browser CAD** link it returns and approve the named
   device using your current team sign-in. Return and ask the assistant to check
   status. Pairing alone does not grant CAD access.
4. Ask: **“Open Onshape.”** Sign in yourself in the visible window. Choose a
   disposable document and ask the assistant to list Vantage CAD workflows.

If a Vantage pairing already exists, the assistant will use it or ask before
replacing it. Existing credentials stay unchanged until a new Onshape approval
is verified and saved. Starting the connector alone opens no browser and starts
no repeated checks.

For example: “Use Vantage CAD to make a 60 × 40 × 10 mm aluminum plate in a new
document. Ask about anything missing, then verify dimensions and mass.”

Keep one assistant working on a document at a time. The separate Vantage desktop
browser is not the same session as this extension. Disable the connector in your
AI app to close its browser, or ask **“Stop Vantage CAD.”** Stop keeps your pairing
for next time. A model is complete only after its result is inspected.

## When setup needs attention

- **Device pairing required:** ask the assistant to start pairing, approve its
  link in Vantage, then tell it to check once. Installing this file does not enroll
  a device or bypass Browser CAD approval.
- **Pairing expired:** start a new pairing. Codes expire after ten minutes; there
  is no automatic polling or hidden retry job.
- **Credential could not be saved:** keep the connector open, resolve the storage
  problem, then ask it to check pairing again. Windows requires the packaged OS
  credential adapter; it will not write a new credential to an unprotected file.
- **Access could not be verified:** check your sign-in, team membership and device
  approval. The connector stops permitting work when that approval is no longer valid.
- **Wrong computer type or missing browser:** obtain the matching approved release;
  the connector does not download a replacement or fall back to an API.
- **Ambiguous control or changed model:** ask the assistant to observe again. Do
  not repeat an uncertain command blindly; it may already have changed the model.

## What the extension shares

Your chosen AI client receives screenshots and visible Onshape document content
for the tools you use. Onshape sign-in stays in the temporary browser; the
connector does not export cookies or send the session to Vantage. It uses the
existing locally stored Vantage device credential only to check current access
with the trusted Vantage service. No credentials belong in prompts or screenshots.

The guided pairing source still requires hosted and packaged acceptance before
release. Support for every ChatGPT or Claude app version is not claimed.
