import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { sendMessage } from "@/modules/conversations/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await sendMessage(await requireUser(), (await context.params).id, await request.json()), { status: 201 }), request); }
