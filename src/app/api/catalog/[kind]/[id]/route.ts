import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { saveCatalog } from "@/modules/catalog/service";
export async function PATCH(request: Request, context: { params: Promise<{ kind: string; id: string }> }) { return handleApi(async () => { const actor = await requireRole("ADMIN"); const { kind, id } = await context.params; return Response.json(await saveCatalog(kind, await request.json(), actor, id)); }, request); }
