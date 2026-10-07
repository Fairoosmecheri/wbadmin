import { handleApi } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/authorization";
import { listCustomers, saveCustomer } from "@/modules/customers/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await listCustomers(Object.fromEntries(new URL(request.url).searchParams), await requireUser())), request); }
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); return Response.json(await saveCustomer(await request.json(), actor), { status: 201 }); }, request); }
