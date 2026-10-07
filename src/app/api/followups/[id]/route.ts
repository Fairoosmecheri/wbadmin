import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { updateFollowUp } from "@/modules/followups/service";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await updateFollowUp(await requireUser(), (await context.params).id, await request.json())), request); }
