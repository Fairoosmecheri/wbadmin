import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { listSavedViews, saveSavedView } from "@/modules/segments/service";

export async function GET(request: Request) { return handleApi(async () => Response.json(await listSavedViews(await requireUser())), request); }
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireUser(); return Response.json(await saveSavedView(await request.json(), actor), { status: 201 }); }, request); }
