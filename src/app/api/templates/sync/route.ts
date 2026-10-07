import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { syncTemplates } from "@/modules/templates/service";
export async function POST(request: Request) { return handleApi(async () => Response.json(await syncTemplates(await requireRole("ADMIN", "MANAGER"))), request); }
