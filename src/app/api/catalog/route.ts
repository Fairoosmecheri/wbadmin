import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { getCatalog } from "@/modules/catalog/service";
export async function GET(request: Request) { return handleApi(async () => { const actor = await requireUser(); return Response.json(await getCatalog(actor.role === "ADMIN" && new URL(request.url).searchParams.get("includeInactive") === "true")); }, request); }
