import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { previewCampaign } from "@/modules/campaigns/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await previewCampaign((await context.params).id, await requireRole("ADMIN", "MANAGER"))), request); }
