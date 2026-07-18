import { getPublicAuthCapabilities } from "@vantage/core";

export async function GET() {
  const response = Response.json(getPublicAuthCapabilities());
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
