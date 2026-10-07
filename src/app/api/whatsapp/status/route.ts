import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { whatsappStatus } from "@/modules/whatsapp/settings";
export async function GET(request: Request) { return handleApi(async () => Response.json(await whatsappStatus(await requireRole("ADMIN"))), request); }
