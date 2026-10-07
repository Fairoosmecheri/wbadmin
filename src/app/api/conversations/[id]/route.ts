import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { getConversation, updateConversation } from "@/modules/conversations/service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => Response.json(await getConversation(await requireUser(), (await context.params).id, new URL(request.url).searchParams.get("before"))), request); }
export async function PATCH(request: Request, context: Context) { return handleApi(async () => Response.json(await updateConversation(await requireUser(), (await context.params).id, await request.json())), request); }
