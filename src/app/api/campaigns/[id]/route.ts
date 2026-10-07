import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { getCampaign, saveCampaign } from "@/modules/campaigns/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await getCampaign((await context.params).id, await requireRole("ADMIN", "MANAGER"))), request); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await saveCampaign(await request.json(), await requireRole("ADMIN", "MANAGER"), (await context.params).id)), request); }
