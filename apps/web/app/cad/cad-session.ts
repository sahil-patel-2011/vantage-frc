const DEMO_RETURNED_ID = /demo/i;

export function asParamRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Accept only a real returned id. DEMO / blank / non-strings are not ids. */
export function realReturnedId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || DEMO_RETURNED_ID.test(id)) return undefined;
  return id;
}

/** First non-empty planned id from a string or string[]. Blank stays blank. */
export function firstRememberedId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

export function withVariableStudio(
  payload: { operation?: string; parameters?: unknown; reason?: string },
  studioId: string,
) {
  if (payload.operation !== "set_variable" || !studioId) return payload;
  const parameters = asParamRecord(payload.parameters);
  if (String(parameters.variableStudioElementId ?? "").trim()) return payload;
  return { ...payload, parameters: { ...parameters, variableStudioElementId: studioId } };
}

/** Fill add_assembly_instance / create_mate from a real prior create_assembly id. Never invent. */
export function withLastAssemblyElementId(
  operation: string,
  parameters: Record<string, unknown>,
  lastAssemblyElementId: string | undefined,
): Record<string, unknown> {
  if (operation !== "add_assembly_instance" && operation !== "create_mate") return parameters;
  if (String(parameters.assemblyElementId ?? "").trim() || !lastAssemblyElementId) return parameters;
  return { ...parameters, assemblyElementId: lastAssemblyElementId };
}

export function rememberLastAssemblyElementId(
  operation: string,
  executed: { featureId?: unknown; result?: Record<string, unknown> },
  current: string | undefined,
): string | undefined {
  if (operation !== "create_assembly") return current;
  return realReturnedId(executed.featureId) ?? realReturnedId(executed.result?.elementId) ?? current;
}

export function assemblyStorageKey(orgId: string, documentId: string): string {
  return `vantage-cad-assembly:${orgId}:${documentId}`;
}

export function variableStudioStorageKey(orgId: string, documentId: string): string {
  return `vantage-cad-variables:${orgId}:${documentId}`;
}

/** Only store/restore a real non-DEMO assembly element id. */
export function readStoredAssemblyElementId(orgId: string, documentId: string): string | undefined {
  const oid = realReturnedId(orgId);
  const did = realReturnedId(documentId);
  if (!oid || !did || typeof sessionStorage === "undefined") return undefined;
  try {
    return realReturnedId(sessionStorage.getItem(assemblyStorageKey(oid, did)));
  } catch {
    return undefined;
  }
}

export function writeStoredAssemblyElementId(orgId: string, documentId: string, id: string | undefined) {
  const oid = realReturnedId(orgId);
  const did = realReturnedId(documentId);
  const aid = realReturnedId(id);
  if (!oid || !did || typeof sessionStorage === "undefined") return;
  try {
    const key = assemblyStorageKey(oid, did);
    if (!aid) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, aid);
  } catch {
    // sessionStorage can be blocked (private mode); assembly memory stays in-session only.
  }
}

export function readStoredVariableStudioElementId(orgId: string, documentId: string): string | undefined {
  const oid = realReturnedId(orgId);
  const did = realReturnedId(documentId);
  if (!oid || !did || typeof sessionStorage === "undefined") return undefined;
  try {
    return realReturnedId(sessionStorage.getItem(variableStudioStorageKey(oid, did)));
  } catch {
    return undefined;
  }
}

export function writeStoredVariableStudioElementId(orgId: string, documentId: string, id: string | undefined) {
  const oid = realReturnedId(orgId);
  const did = realReturnedId(documentId);
  const sid = realReturnedId(id);
  if (!oid || !did || typeof sessionStorage === "undefined") return;
  try {
    const key = variableStudioStorageKey(oid, did);
    if (!sid) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, sid);
  } catch {
    // sessionStorage can be blocked (private mode); Variable Studio memory stays in-session only.
  }
}

/** Pass through a real execute checkpoint id / checkpointRef. Never invent. */
export function checkpointIdFromExecute(executed: { result?: Record<string, unknown> }): string | undefined {
  const result = executed.result;
  if (!result) return undefined;
  const output = asParamRecord(result.output);
  const candidates = [result.checkpointId, result.checkpointRef, output.checkpointId, output.checkpointRef];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function onshapeTabUrl(documentId: string, workspaceId: string, elementId: string): string {
  return `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}/e/${elementId}`;
}

/** Fill create_mate from remembered add_assembly_instance ids. Never invent. */
export function withLastInstanceIds(
  operation: string,
  parameters: Record<string, unknown>,
  lastInstanceIds: readonly string[],
): Record<string, unknown> {
  if (operation !== "create_mate") return parameters;
  const firstBlank = !firstRememberedId(parameters.firstInstanceId);
  const secondBlank = !firstRememberedId(parameters.secondInstanceId);
  if (!firstBlank && !secondBlank) return parameters;
  const firstId = lastInstanceIds[0];
  const secondId = lastInstanceIds[1];
  if ((!firstBlank || !firstId) && (!secondBlank || !secondId)) return parameters;
  return {
    ...parameters,
    ...(firstBlank && firstId ? { firstInstanceId: firstId } : {}),
    ...(secondBlank && secondId ? { secondInstanceId: secondId } : {}),
  };
}

export function rememberLastInstanceIds(
  operation: string,
  executed: { featureId?: unknown },
  current: string[],
): string[] {
  if (operation !== "add_assembly_instance") return current;
  const id = realReturnedId(executed.featureId);
  if (!id || current.includes(id)) return current;
  return [...current, id];
}
