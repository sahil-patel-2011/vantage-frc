import { getAuthCapabilities } from "@vantage/core";

export async function GET() {
  return Response.json(getAuthCapabilities());
}
