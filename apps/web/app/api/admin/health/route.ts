import { AdminRouteError, NO_STORE, adminErrorResponse, asPlatformAdmin } from "../../../../lib/admin/admin-route";
import { loadModuleHealth } from "../../../../lib/admin/load-module-health";
import { isModuleId, moduleListItem, summarizeModules } from "../../../../lib/admin/module-health";

/**
 * Module health, for platform admins only (everyone else gets 404). GET is the list;
 * `?module=<id>` is one module with its problem, since when, recent errors and log lines
 * (redacted) and how to fix it. Every request gathers the signals again, so "Check again" is
 * just another GET.
 */
export async function GET(request: Request) {
  try {
    const moduleId = new URL(request.url).searchParams.get("module");
    if (moduleId && !isModuleId(moduleId)) throw new AdminRouteError(404, "There is no module with that name.");
    const modules = await asPlatformAdmin((client) => loadModuleHealth(client));
    if (moduleId) {
      const module = modules.find((entry) => entry.id === moduleId)!;
      return Response.json({ module }, { headers: NO_STORE });
    }
    return Response.json(
      {
        checkedAt: modules[0]?.checkedAt ?? new Date().toISOString(),
        summary: summarizeModules(modules),
        modules: modules.map(moduleListItem),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return adminErrorResponse(error, "Module health didn't load. Try again.");
  }
}
