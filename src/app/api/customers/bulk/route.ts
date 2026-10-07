import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { bulkCustomers } from "@/modules/customers/service";
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); return Response.json(await bulkCustomers(await request.json(), actor)); }, request); }
