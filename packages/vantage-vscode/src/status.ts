import * as vscode from "vscode";
import type { EditorSession } from "./types";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "vantage.signIn";
    this.item.show();
  }

  update(session: EditorSession | undefined) {
    if (!session) {
      this.item.text = "$(debug-disconnect) Vantage";
      this.item.tooltip = "Not connected — click to pair with Vantage";
      this.item.command = "vantage.signIn";
      return;
    }
    const label = session.orgName || "Connected";
    this.item.text = `$(check) Vantage: ${label}`;
    this.item.tooltip = session.mock
      ? `Mock session · ${label}\nClick to manage connection`
      : `Connected · ${label}\nClick to show organization`;
    this.item.command = "vantage.selectOrg";
  }

  dispose() {
    this.item.dispose();
  }
}
