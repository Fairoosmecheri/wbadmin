import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { previewAudience } from "@/modules/campaigns/service";
export async function POST(request: Request) { return handleApi(async () => Response.json(await previewAudience(await request.json(), await requireRole("ADMIN", "MANAGER"))), request); }
