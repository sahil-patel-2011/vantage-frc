import * as vscode from "vscode";

export function getBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration("vantage").get<string>("baseUrl")?.trim();
  const url = (configured || "https://vantagefrc.com").replace(/\/+$/, "");
  return url;
}

export function useMockPairing(): boolean {
  return Boolean(vscode.workspace.getConfiguration("vantage").get<boolean>("mockPairing"));
}

export function includeDiagnosticsDefault(): boolean {
  return vscode.workspace.getConfiguration("vantage").get<boolean>("includeDiagnostics") !== false;
}

export function maxContentChars(): number {
  const value = vscode.workspace.getConfiguration("vantage").get<number>("maxContentChars");
  if (typeof value !== "number" || Number.isNaN(value)) return 48_000;
  return Math.min(48_000, Math.max(1_000, Math.floor(value)));
}
