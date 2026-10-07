import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { getImport, importPageSchema } from "@/modules/imports/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => { const query = new URL(request.url).searchParams; return Response.json(await getImport((await context.params).id, await requireRole("ADMIN", "MANAGER"), importPageSchema.parse(query.get("page") || undefined), query.get("only") || "all")); }, request); }
