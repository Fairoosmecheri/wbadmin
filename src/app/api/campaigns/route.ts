import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { listCampaigns, saveCampaign } from "@/modules/campaigns/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await listCampaigns(Object.fromEntries(new URL(request.url).searchParams), await requireRole("ADMIN", "MANAGER"))), request); }
export async function POST(request: Request) { return handleApi(async () => Response.json(await saveCampaign(await request.json(), await requireRole("ADMIN", "MANAGER")), { status: 201 }), request); }
