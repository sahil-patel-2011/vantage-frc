import {
  buildCadCompatibilityMatrix,
  checkRelayCompatibility,
} from "@vantage/cad";

/**
 * Public CAD compatibility matrix + optional client probe.
 * Used by the web app, vantage-cad diagnose/doctor, and CI smoke checks.
 * No auth — protocol/OS facts only (no secrets or org data).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const matrix = buildCadCompatibilityMatrix();
  const check = checkRelayCompatibility({
    protocol: url.searchParams.get("protocol"),
    cliVersion: url.searchParams.get("cliVersion"),
    addinVersion: url.searchParams.get("addinVersion"),
    platform: url.searchParams.get("platform"),
  });
  return Response.json(
    {
      ...matrix,
      check,
    },
    {
      headers: {
        "cache-control": "public, max-age=60",
      },
    },
  );
}
