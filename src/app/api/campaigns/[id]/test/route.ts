import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { testCampaign } from "@/modules/campaigns/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await testCampaign((await context.params).id, await request.json(), await requireRole("ADMIN", "MANAGER"))), request); }
