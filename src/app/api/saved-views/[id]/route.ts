import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { deleteSavedView, getSavedView, saveSavedView } from "@/modules/segments/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => Response.json(await getSavedView((await context.params).id, await requireUser())), request); }
export async function PATCH(request: Request, context: Context) { return handleApi(async () => { const actor = await requireUser(); return Response.json(await saveSavedView(await request.json(), actor, (await context.params).id)); }, request); }
export async function DELETE(request: Request, context: Context) { return handleApi(async () => Response.json(await deleteSavedView((await context.params).id, await requireUser())), request); }
