import { handleApi } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/authorization";
import { getCustomer, saveCustomer, updateCustomerOutcome, bulkCustomers } from "@/modules/customers/service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => Response.json(await getCustomer((await context.params).id, await requireUser())), request); }
export async function PUT(request: Request, context: Context) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); return Response.json(await saveCustomer(await request.json(), actor, (await context.params).id)); }, request); }
export async function PATCH(request: Request, context: Context) { return handleApi(async () => { const actor = await requireUser(); return Response.json(await updateCustomerOutcome((await context.params).id, await request.json(), actor)); }, request); }
export async function DELETE(request: Request, context: Context) { return handleApi(async () => Response.json(await bulkCustomers({ ids: [(await context.params).id], action: "archive" }, await requireRole("ADMIN"))), request); }
