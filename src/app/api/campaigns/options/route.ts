import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { campaignOptions } from "@/modules/campaigns/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await campaignOptions(await requireRole("ADMIN", "MANAGER"))), request); }
