import * as os from "node:os";
import * as vscode from "vscode";
import { pollPairing, startPairing } from "./api";
import { getBaseUrl, useMockPairing } from "./config";
import { saveSession } from "./session";
import type { EditorSession } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockPair(secrets: vscode.SecretStorage): Promise<EditorSession> {
  const session: EditorSession = {
    deviceToken: `mock-${Date.now()}`,
    deviceId: "mock-device",
    orgId: "mock-org",
    orgName: "Mock Team (local)",
    userId: "mock-user",
    scopes: ["editor.context.submit"],
    vantageUrl: getBaseUrl(),
    mock: true,
  };
  await saveSession(secrets, session);
  return session;
}

export async function runPairFlow(secrets: vscode.SecretStorage): Promise<EditorSession | undefined> {
  if (useMockPairing()) {
    const session = await mockPair(secrets);
    void vscode.window.showInformationMessage(
      "Vantage mock pairing enabled. Context shares stay local to this editor until you disable vantage.mockPairing.",
    );
    return session;
  }

  const machineName = `${os.hostname()} · ${os.userInfo().username || "user"}`.slice(0, 100);
  const extensionVersion = vscode.extensions.getExtension("vantage-frc.vantage-vscode")?.packageJSON?.version ?? "0.1.0";

  let start;
  try {
    start = await startPairing({
      machineName,
      extensionVersion: String(extensionVersion),
      platform: process.platform,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const choice = await vscode.window.showErrorMessage(
      `Could not reach Vantage pair API (${message}). Enable mock pairing for offline testing?`,
      "Enable mock pairing",
      "Cancel",
    );
    if (choice === "Enable mock pairing") {
      await vscode.workspace.getConfiguration("vantage").update("mockPairing", true, vscode.ConfigurationTarget.Global);
      return mockPair(secrets);
    }
    return undefined;
  }

  const open = "Open browser to approve";
  const copy = "Copy code";
  const pick = await vscode.window.showInformationMessage(
    `Vantage pairing code: ${start.userCode}\nApprove in the browser, then return here.`,
    { modal: true },
    open,
    copy,
  );
  if (pick === open) {
    await vscode.env.openExternal(vscode.Uri.parse(start.verificationUri));
  } else if (pick === copy) {
    await vscode.env.clipboard.writeText(start.userCode);
  } else {
    return undefined;
  }

  const deadline = Date.now() + (start.expiresIn || 600) * 1000;
  const intervalMs = Math.max(2, start.interval || 3) * 1000;

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for Vantage pairing approval…",
      cancellable: true,
    },
    async (progress, token) => {
      while (Date.now() < deadline) {
        if (token.isCancellationRequested) return undefined;
        const poll = await pollPairing(start.pollToken);
        if (poll.status === "pending") {
          progress.report({ message: `Code ${start.userCode}` });
          await sleep(intervalMs);
          continue;
        }
        if (poll.status === "expired" || poll.status === "consumed") {
          void vscode.window.showErrorMessage("Pairing code expired. Run Vantage: Sign In again.");
          return undefined;
        }
        if (poll.status === "approved") {
          const session: EditorSession = {
            deviceToken: poll.deviceToken,
            deviceId: poll.deviceId,
            orgId: poll.orgId,
            orgName: poll.orgName || "Team",
            userId: poll.userId,
            scopes: poll.scopes ?? ["editor.context.submit"],
            vantageUrl: getBaseUrl(),
          };
          await saveSession(secrets, session);
          void vscode.window.showInformationMessage(`Connected to Vantage · ${session.orgName}`);
          return session;
        }
      }
      void vscode.window.showErrorMessage("Pairing timed out. Run Vantage: Sign In again.");
      return undefined;
    },
  );
}
