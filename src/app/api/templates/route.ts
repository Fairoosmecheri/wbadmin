import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { listTemplates } from "@/modules/templates/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await listTemplates(await requireUser(), new URL(request.url).searchParams)), request); }
