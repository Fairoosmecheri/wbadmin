import { handleApi } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/authorization";
import { deleteSegment, getSegment, saveSegment } from "@/modules/segments/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => Response.json(await getSegment((await context.params).id, await requireUser())), request); }
export async function PATCH(request: Request, context: Context) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); return Response.json(await saveSegment(await request.json(), actor, (await context.params).id)); }, request); }
export async function DELETE(request: Request, context: Context) { return handleApi(async () => Response.json(await deleteSegment((await context.params).id, await requireRole("ADMIN", "MANAGER"))), request); }
