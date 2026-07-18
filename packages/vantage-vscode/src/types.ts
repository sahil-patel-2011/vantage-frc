export type EditorSession = {
  deviceToken: string;
  deviceId: string;
  orgId: string;
  orgName: string;
  userId: string;
  scopes: string[];
  vantageUrl: string;
  mock?: boolean;
};

export type PairStartResponse = {
  userCode: string;
  pollToken: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type PairPollResponse =
  | { status: "pending" }
  | { status: "expired" | "consumed" }
  | {
      status: "approved";
      deviceToken: string;
      deviceId: string;
      orgId: string;
      orgName?: string;
      userId: string;
      scopes?: string[];
    };

export type EditorContextPayload = {
  intent: "ask_selection" | "review_file" | "share_context";
  optIn: true;
  workspaceRoot?: string;
  relativePath?: string;
  languageId?: string;
  selection?: { startLine: number; endLine: number; text: string };
  fileContent?: string;
  diagnostics?: Array<{ severity: string; message: string; line?: number }>;
  prompt?: string;
};

export type ContextSubmitResponse = {
  success: boolean;
  contextId: string;
  summary: {
    intent: string;
    relativePath: string | null;
    languageId: string | null;
    contentChars: number;
    diagnosticsCount: number;
  };
  deepLinks: { chat: string; code: string };
};
