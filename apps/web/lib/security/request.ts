import { z, type ZodType } from "zod";

export class RequestSecurityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function expectedOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return host ? `${protocol || url.protocol.replace(":", "")}://${host}` : url.origin;
}

/**
 * Parse a cookie-authenticated JSON mutation with strict browser-origin and size boundaries.
 * Requiring application/json also keeps ordinary cross-site HTML forms from reaching mutations.
 */
export async function parseSecureJson<T>(
  request: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestSecurityError(415, "Content-Type must be application/json.");
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new RequestSecurityError(403, "Cross-site mutation blocked.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin(request)) {
    throw new RequestSecurityError(403, "Request origin is not allowed.");
  }

  const maxBytes = options.maxBytes ?? 16_384;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestSecurityError(413, "Request body is too large.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new RequestSecurityError(413, "Request body is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestSecurityError(400, "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RequestSecurityError(400, "Request fields are invalid.");
  }
  return parsed.data;
}

export function securityErrorResponse(error: unknown, fallback: string) {
  const json = (message: string, status: number) => {
    const response = Response.json({ error: message }, { status });
    response.headers.set("cache-control", "private, no-store, max-age=0");
    return response;
  };
  if (error instanceof RequestSecurityError) {
    return json(error.message, error.status);
  }
  if (error instanceof z.ZodError) {
    return json("Request fields are invalid.", 400);
  }
  const databaseCode = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error && !/^[0-9A-Z]{5}$/.test(databaseCode)
    ? error.message
    : fallback;
  return json(message, 400);
}
