export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type RunFn = (body: ActionBody, key: string) => Promise<void>;
export type ProviderSetupStep = { id: string; label: string; detail: string; href: string };
