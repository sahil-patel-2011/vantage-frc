import { parseAddedFeatureId } from "./onshape-features";

export type OnshapeNativeHttp = (path: string, init?: RequestInit) => Promise<Response>;
export type OnshapeMateType = "FASTENED" | "REVOLUTE" | "SLIDER" | "CYLINDRICAL";

export type OnshapeAssemblyRef = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

function required(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function finite(value: unknown, label: string, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

async function jsonResponse(response: Response, action: string): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body ?? {});
    throw new Error(`${action} failed (HTTP ${response.status}): ${detail.slice(0, 400)}`);
  }
  return body;
}

function elementId(body: unknown, action: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = String(record.id ?? record.elementId ?? "").trim();
  if (!id) throw new Error(`${action} succeeded but Onshape returned no element id`);
  return id;
}

function instanceId(body: unknown): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = String(record.id ?? record.instanceId ?? record.nodeId ?? "").trim();
  if (!id) throw new Error("Add assembly instance succeeded but Onshape returned no instance id");
  return id;
}

export function onshapeAssemblyPath(ref: OnshapeAssemblyRef, suffix = ""): string {
  return `/assemblies/d/${encodeURIComponent(required(ref.documentId, "documentId"))}/w/${encodeURIComponent(required(ref.workspaceId, "workspaceId"))}/e/${encodeURIComponent(required(ref.elementId, "assemblyElementId"))}${suffix}`;
}

export async function createOnshapePartStudio(
  http: OnshapeNativeHttp,
  input: { documentId: string; workspaceId: string; name: string },
): Promise<{ elementId: string; name: string }> {
  const documentId = required(input.documentId, "documentId");
  const workspaceId = required(input.workspaceId, "workspaceId");
  const name = required(input.name, "Part Studio name");
  const response = await http(
    `/partstudios/d/${encodeURIComponent(documentId)}/w/${encodeURIComponent(workspaceId)}`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  const body = await jsonResponse(response, "Create Part Studio");
  return { elementId: elementId(body, "Create Part Studio"), name };
}

export async function getOnshapeBodyDetails(
  http: OnshapeNativeHttp,
  input: { documentId: string; workspaceId: string; elementId: string },
): Promise<unknown> {
  const response = await http(
    `/partstudios/d/${encodeURIComponent(required(input.documentId, "documentId"))}/w/${encodeURIComponent(required(input.workspaceId, "workspaceId"))}/e/${encodeURIComponent(required(input.elementId, "elementId"))}/bodydetails`,
  );
  return jsonResponse(response, "Get Part Studio body details");
}

export function summarizeOnshapeBodyDetails(
  details: unknown,
  maxFacesPerBody = 80,
): Array<{
  partId: string;
  bodyType: string;
  faces: Array<{ faceId: string; surfaceType: string }>;
}> {
  const record = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const bodies = Array.isArray(record.bodies) ? record.bodies : [];
  return bodies.map((rawBody) => {
    const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
    const faces = Array.isArray(body.faces) ? body.faces : [];
    return {
      partId: String(body.id ?? body.partId ?? ""),
      bodyType: String(body.type ?? body.bodyType ?? ""),
      faces: faces.slice(0, maxFacesPerBody).map((rawFace) => {
        const face = rawFace && typeof rawFace === "object" ? (rawFace as Record<string, unknown>) : {};
        const surface =
          face.surface && typeof face.surface === "object"
            ? (face.surface as Record<string, unknown>)
            : {};
        return {
          faceId: String(face.id ?? face.deterministicId ?? ""),
          surfaceType: String(surface.type ?? surface.surfaceType ?? face.surfaceType ?? ""),
        };
      }),
    };
  });
}

export async function createOnshapeAssembly(
  http: OnshapeNativeHttp,
  input: { documentId: string; workspaceId: string; name: string },
): Promise<{ elementId: string; name: string }> {
  const documentId = required(input.documentId, "documentId");
  const workspaceId = required(input.workspaceId, "workspaceId");
  const name = required(input.name, "Assembly name");
  const response = await http(
    `/assemblies/d/${encodeURIComponent(documentId)}/w/${encodeURIComponent(workspaceId)}`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  const body = await jsonResponse(response, "Create assembly");
  return { elementId: elementId(body, "Create assembly"), name };
}

export async function getOnshapeAssembly(
  http: OnshapeNativeHttp,
  assembly: OnshapeAssemblyRef,
): Promise<unknown> {
  const response = await http(`${onshapeAssemblyPath(assembly)}?includeMateFeatures=true`);
  return jsonResponse(response, "Get assembly");
}

export async function addOnshapeAssemblyInstance(
  http: OnshapeNativeHttp,
  input: {
    assembly: OnshapeAssemblyRef;
    sourceDocumentId?: string;
    sourceElementId: string;
    partId?: string;
    isAssembly?: boolean;
  },
): Promise<{ instanceId: string }> {
  const sourceDocumentId = required(
    input.sourceDocumentId ?? input.assembly.documentId,
    "sourceDocumentId",
  );
  const sourceElementId = required(input.sourceElementId, "sourceElementId");
  const isAssembly = Boolean(input.isAssembly);
  const partId = String(input.partId ?? "").trim();
  const body = isAssembly
    ? { documentId: sourceDocumentId, elementId: sourceElementId, isAssembly: true }
    : {
        documentId: sourceDocumentId,
        elementId: sourceElementId,
        partId: partId || null,
        isAssembly: false,
        isWholePartStudio: !partId,
      };
  const response = await http(onshapeAssemblyPath(input.assembly, "/instances"), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { instanceId: instanceId(await jsonResponse(response, "Add assembly instance")) };
}

export function onshapeMateConnectorFeature(input: {
  name: string;
  instanceId: string;
  faceId: string;
  flipPrimary?: boolean;
  secondaryAxisType?: "PLUS_X" | "PLUS_Y" | "MINUS_X" | "MINUS_Y";
  offsetXMm?: number;
  offsetYMm?: number;
  offsetZMm?: number;
}) {
  const parameters: Record<string, unknown>[] = [
    {
      btType: "BTMParameterEnum-145",
      parameterId: "originType",
      enumName: "Origin type",
      value: "ON_ENTITY",
    },
    {
      btType: "BTMParameterQueryWithOccurrenceList-67",
      parameterId: "originQuery",
      queries: [
        {
          btType: "BTMInferenceQueryWithOccurrence-1083",
          inferenceType: "CENTROID",
          path: [required(input.instanceId, "instanceId")],
          deterministicIds: [required(input.faceId, "faceId")],
        },
      ],
    },
  ];
  if (input.flipPrimary) {
    parameters.push({
      btType: "BTMParameterBoolean-144",
      parameterId: "flipPrimary",
      value: true,
    });
  }
  const secondaryAxisType = input.secondaryAxisType ?? "PLUS_X";
  if (!["PLUS_X", "PLUS_Y", "MINUS_X", "MINUS_Y"].includes(secondaryAxisType)) {
    throw new Error("secondaryAxisType must be PLUS_X, PLUS_Y, MINUS_X, or MINUS_Y");
  }
  if (secondaryAxisType !== "PLUS_X") {
    parameters.push({
      btType: "BTMParameterEnum-145",
      parameterId: "secondaryAxisType",
      enumName: "Reorient secondary axis",
      value: secondaryAxisType,
    });
  }
  const offsets = [
    finite(input.offsetXMm, "offsetXMm"),
    finite(input.offsetYMm, "offsetYMm"),
    finite(input.offsetZMm, "offsetZMm"),
  ];
  if (offsets.some((value) => value !== 0)) {
    parameters.push({
      btType: "BTMParameterBoolean-144",
      parameterId: "transform",
      value: true,
    });
    for (const [index, parameterId] of ["translationX", "translationY", "translationZ"].entries()) {
      parameters.push({
        btType: "BTMParameterQuantity-147",
        parameterId,
        expression: `${offsets[index]! / 1000} m`,
        isInteger: false,
      });
    }
  }
  return {
    feature: {
      btType: "BTMMateConnector-66",
      featureType: "mateConnector",
      name: required(input.name, "Mate connector name"),
      suppressed: false,
      parameters,
    },
  };
}

export function onshapeMateFeature(input: {
  name: string;
  mateType: OnshapeMateType;
  firstConnectorId: string;
  secondConnectorId: string;
  minLimit?: number;
  maxLimit?: number;
}) {
  if (!["FASTENED", "REVOLUTE", "SLIDER", "CYLINDRICAL"].includes(input.mateType)) {
    throw new Error("mateType must be FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL");
  }
  const parameters: Record<string, unknown>[] = [
    {
      btType: "BTMParameterEnum-145",
      parameterId: "mateType",
      enumName: "Mate type",
      value: input.mateType,
    },
    {
      btType: "BTMParameterQueryWithOccurrenceList-67",
      parameterId: "mateConnectorsQuery",
      queries: [input.firstConnectorId, input.secondConnectorId].map((featureId) => ({
        btType: "BTMFeatureQueryWithOccurrence-157",
        featureId: required(featureId, "mateConnectorId"),
        path: [],
        queryData: "",
      })),
    },
  ];
  const hasMin = input.minLimit !== undefined;
  const hasMax = input.maxLimit !== undefined;
  if (hasMin !== hasMax) throw new Error("Both minLimit and maxLimit are required when mate limits are enabled");
  if (hasMin && hasMax && input.mateType !== "FASTENED") {
    const min = finite(input.minLimit, "minLimit");
    const max = finite(input.maxLimit, "maxLimit");
    if (min > max) throw new Error("minLimit cannot be greater than maxLimit");
    const revolute = input.mateType === "REVOLUTE";
    const scale = revolute ? Math.PI / 180 : 1 / 1000;
    parameters.push(
      {
        btType: "BTMParameterBoolean-144",
        parameterId: "limitsEnabled",
        value: true,
      },
      {
        btType: "BTMParameterNullableQuantity-807",
        parameterId: revolute ? "limitAxialZMin" : "limitZMin",
        expression: `${min * scale} ${revolute ? "rad" : "m"}`,
        isInteger: false,
        isNull: false,
      },
      {
        btType: "BTMParameterNullableQuantity-807",
        parameterId: revolute ? "limitAxialZMax" : "limitZMax",
        expression: `${max * scale} ${revolute ? "rad" : "m"}`,
        isInteger: false,
        isNull: false,
      },
    );
  }
  return {
    feature: {
      btType: "BTMMate-64",
      featureType: "mate",
      name: required(input.name, "Mate name"),
      suppressed: false,
      parameters,
    },
  };
}

async function addAssemblyFeature(
  http: OnshapeNativeHttp,
  assembly: OnshapeAssemblyRef,
  payload: unknown,
): Promise<string> {
  const response = await http(onshapeAssemblyPath(assembly, "/features"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseAddedFeatureId(await jsonResponse(response, "Add assembly feature"));
}

async function deleteAssemblyFeature(
  http: OnshapeNativeHttp,
  assembly: OnshapeAssemblyRef,
  featureId: string,
): Promise<void> {
  await http(onshapeAssemblyPath(assembly, `/features/featureid/${encodeURIComponent(featureId)}`), {
    method: "DELETE",
  });
}

export async function createOnshapeMate(
  http: OnshapeNativeHttp,
  input: {
    assembly: OnshapeAssemblyRef;
    name?: string;
    mateType: OnshapeMateType;
    firstInstanceId: string;
    secondInstanceId: string;
    firstFaceId: string;
    secondFaceId: string;
    firstFlipPrimary?: boolean;
    secondFlipPrimary?: boolean;
    firstOffsetXMm?: number;
    firstOffsetYMm?: number;
    firstOffsetZMm?: number;
    secondOffsetXMm?: number;
    secondOffsetYMm?: number;
    secondOffsetZMm?: number;
    minLimit?: number;
    maxLimit?: number;
  },
): Promise<{
  mateFeatureId: string;
  firstConnectorFeatureId: string;
  secondConnectorFeatureId: string;
}> {
  const created: string[] = [];
  try {
    const firstConnectorFeatureId = await addAssemblyFeature(
      http,
      input.assembly,
      onshapeMateConnectorFeature({
        name: `${input.name ?? input.mateType} · connector A`,
        instanceId: input.firstInstanceId,
        faceId: input.firstFaceId,
        flipPrimary: input.firstFlipPrimary,
        offsetXMm: input.firstOffsetXMm,
        offsetYMm: input.firstOffsetYMm,
        offsetZMm: input.firstOffsetZMm,
      }),
    );
    created.push(firstConnectorFeatureId);
    const secondConnectorFeatureId = await addAssemblyFeature(
      http,
      input.assembly,
      onshapeMateConnectorFeature({
        name: `${input.name ?? input.mateType} · connector B`,
        instanceId: input.secondInstanceId,
        faceId: input.secondFaceId,
        flipPrimary: input.secondFlipPrimary,
        offsetXMm: input.secondOffsetXMm,
        offsetYMm: input.secondOffsetYMm,
        offsetZMm: input.secondOffsetZMm,
      }),
    );
    created.push(secondConnectorFeatureId);
    const mateFeatureId = await addAssemblyFeature(
      http,
      input.assembly,
      onshapeMateFeature({
        name: input.name ?? `${input.mateType} mate`,
        mateType: input.mateType,
        firstConnectorId: firstConnectorFeatureId,
        secondConnectorId: secondConnectorFeatureId,
        minLimit: input.minLimit,
        maxLimit: input.maxLimit,
      }),
    );
    return { mateFeatureId, firstConnectorFeatureId, secondConnectorFeatureId };
  } catch (error) {
    await Promise.allSettled(
      [...created].reverse().map((featureId) => deleteAssemblyFeature(http, input.assembly, featureId)),
    );
    throw error;
  }
}
