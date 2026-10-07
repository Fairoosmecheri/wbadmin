import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { customerTimeline } from "@/modules/timeline/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await customerTimeline(await requireUser(), (await context.params).id, Object.fromEntries(new URL(request.url).searchParams))), request); }
