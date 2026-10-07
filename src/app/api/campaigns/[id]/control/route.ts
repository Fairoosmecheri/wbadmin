import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { z } from "zod";
import { controlCampaign } from "@/modules/campaigns/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); const { action } = z.object({ action: z.enum(["pause", "resume", "cancel"]) }).parse(await request.json()); return Response.json(await controlCampaign((await context.params).id, action, actor)); }, request); }
