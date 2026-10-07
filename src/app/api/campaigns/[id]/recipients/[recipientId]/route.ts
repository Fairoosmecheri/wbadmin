import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { classifyRecipient } from "@/modules/campaigns/service";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; recipientId: string }> }) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); const { id, recipientId } = await context.params; return Response.json(await classifyRecipient(id, recipientId, await request.json(), actor)); }, request); }
