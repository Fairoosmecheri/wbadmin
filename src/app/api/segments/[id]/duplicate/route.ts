import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { duplicateSegment } from "@/modules/segments/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await duplicateSegment((await context.params).id, await requireRole("ADMIN", "MANAGER")), { status: 201 }), request); }
