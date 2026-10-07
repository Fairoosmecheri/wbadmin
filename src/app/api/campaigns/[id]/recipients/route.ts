import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { listRecipients } from "@/modules/campaigns/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await listRecipients((await context.params).id, Object.fromEntries(new URL(request.url).searchParams), await requireRole("ADMIN", "MANAGER"))), request); }
