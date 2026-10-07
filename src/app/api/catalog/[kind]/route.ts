import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { saveCatalog } from "@/modules/catalog/service";
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) { return handleApi(async () => { const actor = await requireRole("ADMIN"); return Response.json(await saveCatalog((await context.params).kind, await request.json(), actor), { status: 201 }); }, request); }
